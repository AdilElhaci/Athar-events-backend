import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { Event } from '../events/entities/event.entity';
import { Guest, GuestRsvp } from '../guests/entities/guest.entity';
import { RsvpReviewItem, RsvpReviewsView } from './dto/rsvp-review.dto';
import {
  RsvpReviewDecision,
  WhatsappInbound,
  WhatsappInboundOutcome,
} from './entities/whatsapp-inbound.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from './entities/whatsapp-message.entity';
import { usedCount } from './replacements.service';
import { qrKey, qrTemplateKey } from './whatsapp/whatsapp-sender.service';
import { WhatsappQueue } from './whatsapp/whatsapp-queue.service';

/** Meta's customer-service window, with a margin (as the sender). */
const WINDOW_MS = 23 * 60 * 60 * 1000;

/**
 * Late accepts an admin decides (SP-07, D-53): after the RSVP close, or from a replaced guest when
 * no invitation was vacant. Accept applies the RSVP and sends the QR (an image while the guest's
 * window is open, else the `athar_confirmation` template); dismiss changes nothing. Both are
 * audited; every pending reply of the guest is decided at once.
 */
@Injectable()
export class RsvpReviewsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: WhatsappQueue,
  ) {}

  async list(eventId: string): Promise<RsvpReviewsView> {
    const event = await this.dataSource
      .getRepository(Event)
      .findOneBy({ id: eventId });
    if (!event) throw notFound();
    const rows = await this.dataSource.query<
      {
        inbound_id: string;
        guest_id: string;
        name: string;
        phone: string | null;
        received_at: Date;
        rsvp: string;
        rsvp_locked: boolean;
      }[]
    >(
      `SELECT DISTINCT ON (i.guest_id) i.id AS inbound_id, i.guest_id, g.name, g.phone,
              i.received_at, g.rsvp, g.rsvp_locked
         FROM whatsapp_inbound i JOIN guests g ON g.id = i.guest_id
        WHERE i.event_id = $1 AND i.outcome = $2 AND i.review_decision IS NULL
          AND g.deleted_at IS NULL
        ORDER BY i.guest_id, i.received_at DESC`,
      [eventId, WhatsappInboundOutcome.REVIEW],
    );
    const items: RsvpReviewItem[] = rows
      .map((r) => ({
        inboundId: r.inbound_id,
        guestId: r.guest_id,
        guestName: r.name,
        phone: r.phone,
        receivedAt: r.received_at,
        reason:
          event.rsvpClosesAt && r.received_at >= event.rsvpClosesAt
            ? ('CLOSED' as const)
            : ('NO_VACANT' as const),
        currentRsvp: r.rsvp,
        replaced: r.rsvp_locked,
      }))
      .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    const used = await usedCount(this.dataSource.manager, eventId);
    return { items, vacant: Math.max(0, event.extraMargin - used) };
  }

  async decide(
    actorUserId: string,
    eventId: string,
    inboundId: string,
    decision: 'ACCEPT' | 'DISMISS',
  ): Promise<void> {
    const kick = await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: { id: eventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) throw notFound();
      const inbound = await manager.findOneBy(WhatsappInbound, {
        id: inboundId,
        eventId,
        outcome: WhatsappInboundOutcome.REVIEW,
        reviewDecision: IsNull(),
      });
      if (!inbound?.guestId) throw notFound('rsvp_review.not_found');
      const guest = await manager
        .getRepository(Guest)
        .createQueryBuilder('g')
        .setLock('pessimistic_write')
        .where('g.id = :id AND g.deleted_at IS NULL', { id: inbound.guestId })
        .getOne();
      if (!guest) throw notFound('rsvp_review.not_found');

      let intentId: string | null = null;
      if (decision === 'ACCEPT') {
        if (event.startsAt <= new Date())
          throw conflict('rsvp_review.event_started');
        if (guest.rsvp !== GuestRsvp.ACCEPTED) {
          if (guest.rsvpLocked) {
            if (event.extraMargin - (await usedCount(manager, eventId)) <= 0)
              throw unprocessable('rsvp_review.no_vacant');
            await manager.update(Guest, guest.id, {
              rsvpLocked: false,
              reinstatedAt: new Date(),
            });
          }
          await manager.update(Guest, guest.id, {
            rsvp: GuestRsvp.ACCEPTED,
            rsvpAt: new Date(),
          });
          await cancelPending(manager, guest.id);
          intentId = await this.queueQr(manager, guest, inbound.receivedAt);
        }
      }
      await manager.update(
        WhatsappInbound,
        {
          eventId,
          guestId: guest.id,
          outcome: WhatsappInboundOutcome.REVIEW,
          reviewDecision: IsNull(),
        },
        {
          reviewDecision:
            decision === 'ACCEPT'
              ? RsvpReviewDecision.ACCEPTED
              : RsvpReviewDecision.DISMISSED,
          reviewDecidedAt: new Date(),
          reviewDecidedByUserId: actorUserId,
        },
      );
      await manager.save(AdminAction, {
        actorUserId,
        action: 'rsvp.review',
        targetType: 'event',
        targetId: eventId,
        summary: { guestId: guest.id, inboundId, decision },
      });
      return intentId;
    });
    if (kick) await this.queue.trigger('rsvp.review');
  }

  /** A new QR version: an image inside the guest's window, the confirmation template after it. */
  private async queueQr(
    manager: EntityManager,
    guest: Guest,
    repliedAt: Date,
  ): Promise<string> {
    const [row] = await manager.query<{ v: number | null }[]>(
      `SELECT max(qr_version)::int AS v FROM whatsapp_messages
        WHERE guest_id = $1 AND kind IN ($2, $3)`,
      [guest.id, WhatsappMessageKind.QR, WhatsappMessageKind.QR_TEMPLATE],
    );
    const qrVersion = Math.max(guest.qrVersion, row?.v ?? 0) + 1;
    const inWindow = Date.now() - repliedAt.getTime() < WINDOW_MS;
    const kind = inWindow
      ? WhatsappMessageKind.QR
      : WhatsappMessageKind.QR_TEMPLATE;
    const logicalKey = inWindow
      ? qrKey(guest.id, qrVersion)
      : qrTemplateKey(guest.id, qrVersion);
    const saved = await manager.save(WhatsappMessage, {
      eventId: guest.eventId,
      guestId: guest.id,
      kind,
      logicalKey,
      qrVersion,
    });
    return saved.id;
  }
}

/** The guest accepted: no follow-up or apology is due any more. */
async function cancelPending(manager: EntityManager, guestId: string) {
  await manager.update(
    WhatsappMessage,
    {
      guestId,
      kind: In([
        WhatsappMessageKind.FOLLOW_UP_1,
        WhatsappMessageKind.FOLLOW_UP_2,
        WhatsappMessageKind.APOLOGY,
      ]),
      state: WhatsappMessageState.QUEUED,
    },
    { state: WhatsappMessageState.CANCELLED, lastErrorCode: 'accepted' },
  );
}
