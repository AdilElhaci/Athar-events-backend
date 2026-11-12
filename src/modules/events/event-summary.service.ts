import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  GuestAllocationStatus,
  GuestKind,
  GuestRsvp,
} from '../guests/entities/guest.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../invitations/entities/whatsapp-message.entity';
import { EventSummary } from './dto/event-summary.dto';
import { EventsService } from './events.service';

interface SummaryRow {
  invited: number;
  delivered: number;
  read: number;
  accepted: number;
  declined: number;
  no_reply: number;
  admitted: number;
  extras_used: number;
  eligible_declines: number;
  free_reserves: number;
}

/**
 * Owner counts (SP-04 "Counts", AC-03-6), one aggregate query per poll. Only allocated guests
 * count: a guest the campaign has not reached yet is not "invited". A guest whose send ended
 * `UNKNOWN` but who replied clearly received the invitation, so a reply also counts as invited;
 * this keeps `noReply` from going negative.
 */
@Injectable()
export class EventSummaryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly events: EventsService,
  ) {}

  async get(ownerId: string, eventId: string): Promise<EventSummary> {
    const event = await this.events.get(ownerId, eventId); // 404 unless owned
    const [row] = await this.dataSource.query<SummaryRow[]>(
      `WITH inv AS (
         SELECT m.guest_id,
                bool_or(m.delivery_status IN ($3, $4)) AS delivered,
                bool_or(m.delivery_status = $4) AS read
           FROM whatsapp_messages m
          WHERE m.event_id = $1 AND m.kind = $5 AND m.state = $6
          GROUP BY m.guest_id
       ), g AS (
         SELECT g.kind, g.rsvp, g.rsvp_locked, g.allocation_status, g.checked_in_at,
                g.allocation_status = $2 AND (inv.guest_id IS NOT NULL OR g.rsvp <> $9) AS invited,
                COALESCE(inv.delivered, false) AS delivered,
                COALESCE(inv.read, false) AS read
           FROM guests g
           LEFT JOIN inv ON inv.guest_id = g.id
          WHERE g.event_id = $1 AND g.deleted_at IS NULL
       )
       SELECT COUNT(*) FILTER (WHERE invited)::int AS invited,
              COUNT(*) FILTER (WHERE invited AND delivered)::int AS delivered,
              COUNT(*) FILTER (WHERE invited AND read)::int AS read,
              COUNT(*) FILTER (WHERE invited AND rsvp = $7)::int AS accepted,
              COUNT(*) FILTER (WHERE invited AND rsvp = $8)::int AS declined,
              COUNT(*) FILTER (WHERE invited AND rsvp = $9)::int AS no_reply,
              COUNT(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS admitted,
              COUNT(*) FILTER (WHERE kind = $10 AND allocation_status = $2)::int AS extras_used,
              COUNT(*) FILTER (WHERE invited AND rsvp = $8 AND NOT rsvp_locked)::int AS eligible_declines,
              COUNT(*) FILTER (WHERE kind = $10 AND allocation_status = $11)::int AS free_reserves
         FROM g`,
      [
        eventId,
        GuestAllocationStatus.ALLOCATED,
        WhatsappDeliveryStatus.DELIVERED,
        WhatsappDeliveryStatus.READ,
        WhatsappMessageKind.INVITATION,
        WhatsappMessageState.SENT,
        GuestRsvp.ACCEPTED,
        GuestRsvp.DECLINED,
        GuestRsvp.PENDING,
        GuestKind.RESERVE,
        GuestAllocationStatus.NOT_ALLOCATED,
      ],
    );
    const cap = event.extraMargin;
    const used = row.extras_used;
    return {
      invited: row.invited,
      delivered: row.delivered,
      read: row.read,
      accepted: row.accepted,
      declined: row.declined,
      noReply: row.no_reply,
      extras: {
        cap,
        used,
        available: Math.max(
          0,
          Math.min(row.eligible_declines, cap - used, row.free_reserves),
        ),
      },
      admitted: row.admitted,
      updatedAt: new Date(),
    };
  }
}
