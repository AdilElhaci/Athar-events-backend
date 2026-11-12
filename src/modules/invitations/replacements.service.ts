import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import type { ErrorCode } from '../../shared/messages';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  Event,
  EventCampaignStatus,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import { toAdminGuestView } from '../guests/dto/guest.dto';
import {
  Guest,
  GuestAllocationStatus,
  GuestKind,
  GuestRsvp,
} from '../guests/entities/guest.entity';
import type {
  ExtrasView,
  ReplacementsView,
  SendReplacementsResult,
} from './dto/replacement.dto';
import { InvitationContent } from './entities/invitation-content.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
} from './entities/whatsapp-message.entity';
import { WhatsappQueue } from './whatsapp/whatsapp-queue.service';
import { invitationKey } from './whatsapp/whatsapp-sender.service';

/** Replacements go out only once the campaign has started (they are not scheduled, SP-04). */
const STARTED = [
  EventCampaignStatus.SENDING,
  EventCampaignStatus.PAUSED,
  EventCampaignStatus.SENT,
];

/**
 * D-16 (default pending OQ-01): each distinct decline of an invited guest (a replacement's own
 * decline included) funds at most one reserve guest, and replacements never exceed the package
 * margin. Everything happens in one transaction holding the event row lock; the partial unique
 * index on `replacement_for_guest_id` is the last line of defence.
 */
@Injectable()
export class ReplacementsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly queue: WhatsappQueue,
  ) {}

  /** SCR-24. */
  async view(eventId: string): Promise<ReplacementsView> {
    const event = await this.dataSource
      .getRepository(Event)
      .findOneBy({ id: eventId });
    if (!event) throw notFound();
    const manager = this.dataSource.manager;
    const [declines, reserves, used] = await Promise.all([
      eligibleDeclines(manager, eventId),
      freeReserves(manager, eventId),
      usedCount(manager, eventId),
    ]);
    const sent = await manager.query<
      {
        id: string;
        name: string;
        phone: string | null;
        rsvp: string;
        allocated_at: Date | null;
        replaced_name: string;
      }[]
    >(
      `SELECT r.id, r.name, r.phone, r.rsvp, r.allocated_at, d.name AS replaced_name
         FROM guests r JOIN guests d ON d.id = r.replacement_for_guest_id
        WHERE r.event_id = $1
        ORDER BY r.allocated_at DESC`,
      [eventId],
    );
    return {
      extras: extras(event, used, declines.length, reserves.length),
      eligibleDeclines: declines.map((g) => ({
        id: g.id,
        name: g.name,
        phone: g.phone,
        rsvpAt: g.rsvpAt?.toISOString() ?? null,
      })),
      reserves: reserves.map((g) => ({
        id: g.id,
        name: g.name,
        phone: g.phone,
      })),
      sent: sent.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        rsvp: r.rsvp,
        replacedGuestName: r.replaced_name,
        allocatedAt: r.allocated_at?.toISOString() ?? null,
      })),
      blockedReason: blocked(event),
    };
  }

  async send(
    actorUserId: string,
    eventId: string,
    request: { count?: number; guestIds?: string[] },
  ): Promise<SendReplacementsResult> {
    if (!request.count === !request.guestIds)
      throw unprocessable('replacements.count_or_guests');
    const result = await this.transactionalSend(actorUserId, eventId, request);
    // Replacements are not scheduled: send as soon as the intents are committed (SP-04).
    await this.queue.trigger('replacements.send');
    return result;
  }

  private transactionalSend(
    actorUserId: string,
    eventId: string,
    request: { count?: number; guestIds?: string[] },
  ): Promise<SendReplacementsResult> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: { id: eventId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) throw notFound();
      const reason = blocked(event);
      if (reason) throw conflict(reason);
      const content = await manager.findOneByOrFail(InvitationContent, {
        id: event.approvedContentId!,
      });

      const wanted = request.count ?? request.guestIds!.length;
      const used = await usedCount(manager, eventId);
      if (used + wanted > event.extraMargin)
        throw unprocessable('replacements.margin_exhausted');
      const declines = await eligibleDeclines(manager, eventId, true);
      if (declines.length < wanted)
        throw unprocessable('replacements.no_declines_available');
      let reserves = await freeReserves(manager, eventId, true);
      if (request.guestIds) {
        const byId = new Map(reserves.map((g) => [g.id, g]));
        if (request.guestIds.some((id) => !byId.has(id)))
          throw unprocessable('replacements.guest_invalid');
        reserves = request.guestIds.map((id) => byId.get(id)!);
      }
      if (reserves.length < wanted)
        throw unprocessable('replacements.no_reserves');

      const pairs: Array<{ reserve: string; decline: string }> = [];
      for (let i = 0; i < wanted; i++) {
        const reserve = reserves[i];
        const decline = declines[i];
        await manager.update(
          Guest,
          { id: reserve.id },
          {
            allocationStatus: GuestAllocationStatus.ALLOCATED,
            allocatedAt: new Date(),
            replacementForGuestId: decline.id,
          },
        );
        // The decline is now spent: the guest can no longer change it back (D-16).
        await manager.update(Guest, { id: decline.id }, { rsvpLocked: true });
        await manager
          .createQueryBuilder()
          .insert()
          .into(WhatsappMessage)
          .values({
            eventId,
            guestId: reserve.id,
            kind: WhatsappMessageKind.INVITATION,
            logicalKey: invitationKey(reserve.id, content.version),
            scheduleVersion: event.scheduleVersion,
          })
          .orIgnore()
          .execute();
        pairs.push({ reserve: reserve.id, decline: decline.id });
      }
      await manager.save(AdminAction, {
        actorUserId,
        action: 'replacements.send',
        targetType: 'event',
        targetId: eventId,
        summary: { count: wanted, pairs },
      });

      const allocated = await manager.findBy(
        Guest,
        pairs.map((p) => ({ id: p.reserve })),
      );
      const [declinesLeft, reservesLeft] = await Promise.all([
        eligibleDeclines(manager, eventId),
        freeReserves(manager, eventId),
      ]);
      return {
        allocated: allocated.map(toAdminGuestView),
        extras: extras(
          event,
          used + wanted,
          declinesLeft.length,
          reservesLeft.length,
        ),
      };
    });
  }
}

function blocked(event: Event): ErrorCode | null {
  if (
    event.status === EventStatus.CANCELLED ||
    event.status === EventStatus.CLOSED ||
    event.paymentStatus !== EventPaymentStatus.PAID
  )
    return 'events.closed';
  if (event.startsAt.getTime() <= Date.now())
    return 'replacements.event_started';
  if (!STARTED.includes(event.campaignStatus) || !event.approvedContentId)
    return 'replacements.campaign_not_started';
  return null;
}

const extras = (
  event: Event,
  used: number,
  declines: number,
  reserves: number,
): ExtrasView => ({
  cap: event.extraMargin,
  used,
  available: Math.max(
    0,
    Math.min(declines, event.extraMargin - used, reserves),
  ),
});

async function usedCount(
  manager: EntityManager,
  eventId: string,
): Promise<number> {
  const [row] = await manager.query<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM guests WHERE event_id = $1 AND replacement_for_guest_id IS NOT NULL`,
    [eventId],
  );
  return row.n;
}

/** Allocated guests who declined and have not funded a replacement yet; oldest decline first. */
function eligibleDeclines(
  manager: EntityManager,
  eventId: string,
  lock = false,
): Promise<Guest[]> {
  const qb = manager
    .createQueryBuilder(Guest, 'd')
    .where('d.eventId = :eventId AND d.deletedAt IS NULL', { eventId })
    .andWhere('d.allocationStatus = :allocated AND d.rsvp = :declined', {
      allocated: GuestAllocationStatus.ALLOCATED,
      declined: GuestRsvp.DECLINED,
    })
    .andWhere(
      'NOT EXISTS (SELECT 1 FROM guests r WHERE r.replacement_for_guest_id = d.id)',
    )
    .orderBy('d.rsvpAt', 'ASC', 'NULLS FIRST')
    .addOrderBy('d.id', 'ASC');
  if (lock) qb.setLock('pessimistic_write');
  return qb.getMany();
}

/** Reserve guests not sent yet, in list order. */
function freeReserves(
  manager: EntityManager,
  eventId: string,
  lock = false,
): Promise<Guest[]> {
  const qb = manager
    .createQueryBuilder(Guest, 'g')
    .where('g.eventId = :eventId AND g.deletedAt IS NULL', { eventId })
    .andWhere('g.kind = :reserve AND g.allocationStatus = :free', {
      reserve: GuestKind.RESERVE,
      free: GuestAllocationStatus.NOT_ALLOCATED,
    })
    .andWhere('g.phone IS NOT NULL')
    .orderBy('g.createdAt', 'ASC')
    .addOrderBy('g.id', 'ASC');
  if (lock) qb.setLock('pessimistic_write');
  return qb.getMany();
}
