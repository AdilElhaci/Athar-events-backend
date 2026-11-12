import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { buildMeta, Paginated } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  Event,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import { Guest, GuestRsvp } from '../guests/entities/guest.entity';
import {
  MessagesQueryDto,
  MessageView,
  Resolution,
  toMessageView,
} from './dto/message.dto';
import { InvitationContent } from './entities/invitation-content.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from './entities/whatsapp-message.entity';
import { invitationKey, qrKey } from './whatsapp/whatsapp-sender.service';

/** Meta's customer-service window is 24 h from the guest's reply; same margin as the sender. */
const WINDOW_MS = 23 * 60 * 60 * 1000;
const NEEDS_ACTION = [
  WhatsappMessageState.UNKNOWN,
  WhatsappMessageState.FAILED,
];

/**
 * SCR-25 message log and admin resolution (SP-04 §4 Sending, AC-06-4). An `UNKNOWN` send is never
 * retried by the system; the admin decides: it was sent, it failed, or send again. A resend is a
 * new intent with its own logical key; the original row is kept and marked resolved.
 */
@Injectable()
export class MessagesService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    eventId: string,
    { page, limit, state, delivery, kind, needsAction }: MessagesQueryDto,
  ): Promise<Paginated<MessageView>> {
    const exists = await this.dataSource
      .getRepository(Event)
      .existsBy({ id: eventId });
    if (!exists) throw notFound();
    const qb = this.dataSource
      .getRepository(WhatsappMessage)
      .createQueryBuilder('m')
      .where('m.eventId = :eventId', { eventId });
    if (state) qb.andWhere('m.state = :state', { state });
    if (delivery) qb.andWhere('m.deliveryStatus = :delivery', { delivery });
    if (kind) qb.andWhere('m.kind = :kind', { kind });
    if (needsAction)
      qb.andWhere('m.state IN (:...open) AND m.resolvedAt IS NULL', {
        open: NEEDS_ACTION,
      });
    const [rows, total] = await qb
      .orderBy('m.createdAt', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    const guests = rows.length
      ? await this.dataSource
          .getRepository(Guest)
          .createQueryBuilder('g')
          .select(['g.id', 'g.name', 'g.phone'])
          .where('g.id IN (:...ids)', {
            ids: [...new Set(rows.map((m) => m.guestId))],
          })
          .getMany()
      : [];
    const byId = new Map(guests.map((g) => [g.id, g]));
    return {
      items: rows.map((m) => toMessageView(m, byId.get(m.guestId) ?? null)),
      meta: buildMeta(total, page, limit),
    };
  }

  /** Returns the resolved row and, for a resend, the id of the new intent (sent by the sweeper). */
  resolve(
    actorUserId: string,
    messageId: string,
    resolution: Resolution,
    reason: string,
  ): Promise<{ message: MessageView; resendId: string | null }> {
    return this.dataSource.transaction(async (manager) => {
      const message = await manager.findOne(WhatsappMessage, {
        where: { id: messageId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!message) throw notFound();
      if (!NEEDS_ACTION.includes(message.state) || message.resolvedAt)
        throw conflict('messages.not_resolvable');
      // A definite failure has a known outcome; only `UNKNOWN` can be declared sent or failed.
      if (
        resolution !== 'RESEND' &&
        message.state !== WhatsappMessageState.UNKNOWN
      )
        throw conflict('messages.resolution_invalid');
      const event = await manager.findOne(Event, {
        where: { id: message.eventId },
        lock: { mode: 'pessimistic_write' },
      });
      const guest = await manager.findOne(Guest, {
        where: { id: message.guestId },
        lock: { mode: 'pessimistic_write' },
      });

      let resendId: string | null = null;
      if (resolution === 'RESEND')
        resendId = await this.resend(manager, message, event!, guest);

      await manager.update(
        WhatsappMessage,
        { id: message.id },
        {
          ...(resolution === 'MARK_SENT' && {
            state: WhatsappMessageState.SENT,
          }),
          ...(resolution === 'MARK_FAILED' && {
            state: WhatsappMessageState.FAILED,
            failedAt: new Date(),
          }),
          resolution,
          resolvedAt: new Date(),
          resolvedByUserId: actorUserId,
        },
      );
      await manager.save(AdminAction, {
        actorUserId,
        action: 'message.resolve',
        targetType: 'whatsapp_message',
        targetId: message.id,
        summary: {
          eventId: message.eventId,
          kind: message.kind,
          from: message.state,
          resolution,
          reason,
          resendId,
        },
      });
      const after = await manager.findOneByOrFail(WhatsappMessage, {
        id: message.id,
      });
      return {
        message: toMessageView(after, guest),
        resendId,
      };
    });
  }

  private async resend(
    manager: EntityManager,
    message: WhatsappMessage,
    event: Event,
    guest: Guest | null,
  ): Promise<string> {
    if (event.startsAt <= new Date()) throw conflict('messages.event_started');
    if (
      event.status === EventStatus.CANCELLED ||
      event.status === EventStatus.CLOSED ||
      event.paymentStatus !== EventPaymentStatus.PAID
    )
      throw conflict('events.closed');
    if (!guest || guest.deletedAt || !guest.phone)
      throw conflict('messages.guest_gone');

    if (message.kind === WhatsappMessageKind.INVITATION)
      return this.resendInvitation(manager, event, guest);
    if (message.kind === WhatsappMessageKind.QR)
      return this.resendQr(manager, guest);
    throw unprocessable('messages.kind_unsupported');
  }

  private async resendInvitation(
    manager: EntityManager,
    event: Event,
    guest: Guest,
  ): Promise<string> {
    if (guest.rsvp !== GuestRsvp.PENDING)
      throw conflict('messages.guest_replied');
    const live = await manager.existsBy(WhatsappMessage, {
      guestId: guest.id,
      kind: WhatsappMessageKind.INVITATION,
      state: WhatsappMessageState.SENT,
    });
    const pending = await manager
      .createQueryBuilder(WhatsappMessage, 'm')
      .where('m.guestId = :id AND m.kind = :kind AND m.state IN (:...states)', {
        id: guest.id,
        kind: WhatsappMessageKind.INVITATION,
        states: [WhatsappMessageState.QUEUED, WhatsappMessageState.SENDING],
      })
      .getExists();
    if (live || pending) throw conflict('messages.already_sent');
    if (!event.approvedContentId) throw conflict('campaign.not_approved');
    const content = await manager.findOneByOrFail(InvitationContent, {
      id: event.approvedContentId,
    });
    // The current approved version; a resend of it gets a suffix (the sender accepts `:r<n>`).
    const base = invitationKey(guest.id, content.version);
    const [{ n }] = await manager.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM whatsapp_messages
        WHERE logical_key = $1 OR logical_key LIKE $2`,
      [base, `${base}:r%`],
    );
    return this.insert(manager, {
      eventId: event.id,
      guestId: guest.id,
      kind: WhatsappMessageKind.INVITATION,
      logicalKey: n === 0 ? base : `${base}:r${n}`,
      scheduleVersion: event.scheduleVersion,
    });
  }

  /** A fresh version (new token, the old one revoked on send), only inside the reply window. */
  private async resendQr(manager: EntityManager, guest: Guest) {
    if (guest.rsvp !== GuestRsvp.ACCEPTED)
      throw conflict('messages.guest_not_accepted');
    if (!guest.rsvpAt || Date.now() - guest.rsvpAt.getTime() > WINDOW_MS)
      throw unprocessable('messages.window_closed');
    const pending = await manager
      .createQueryBuilder(WhatsappMessage, 'm')
      .where('m.guestId = :id AND m.kind = :kind AND m.state IN (:...states)', {
        id: guest.id,
        kind: WhatsappMessageKind.QR,
        states: [WhatsappMessageState.QUEUED, WhatsappMessageState.SENDING],
      })
      .getExists();
    if (pending) throw conflict('messages.already_sent');
    const [{ v }] = await manager.query<{ v: number }[]>(
      `SELECT coalesce(max(qr_version), 0)::int AS v FROM whatsapp_messages WHERE guest_id = $1 AND kind = $2`,
      [guest.id, WhatsappMessageKind.QR],
    );
    const qrVersion = Math.max(guest.qrVersion, v) + 1;
    return this.insert(manager, {
      eventId: guest.eventId,
      guestId: guest.id,
      kind: WhatsappMessageKind.QR,
      logicalKey: qrKey(guest.id, qrVersion),
      qrVersion,
    });
  }

  private async insert(
    manager: EntityManager,
    values: Partial<WhatsappMessage>,
  ): Promise<string> {
    const saved = await manager.save(manager.create(WhatsappMessage, values));
    return saved.id;
  }
}
