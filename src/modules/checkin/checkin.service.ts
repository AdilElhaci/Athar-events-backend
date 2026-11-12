import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import { notFound } from '../../shared/exceptions/app.exception';
import {
  Event,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import { GuestRsvp } from '../guests/entities/guest.entity';
import type {
  CheckInResponse,
  PublicInvitationView,
  ScanEventView,
  ScanStats,
} from './dto/checkin.dto';
import { hashQrToken, qrUrl, renderQrSvg } from './qr-token';

/** 32 random bytes as base64url: exactly 43 characters of this alphabet. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 86_400_000;

/**
 * The QR in the camera is the guest-page URL (`…/i/<token>`); manual entry may be either the URL
 * or the bare token. Anything else is not a token.
 */
export function extractToken(raw: string): string | null {
  const text = raw.trim();
  const match = /\/i\/([^/?#\s]+)/.exec(text);
  const token = match ? match[1] : text;
  return TOKEN.test(token) ? token : null;
}

/**
 * Owner-only scanning (D-08, SP-05) and the public guest page. A check-in is one conditional
 * update, so two devices scanning the same code at once admit the guest exactly once (AC-07-3).
 * Tokens are only hashed, never stored or logged.
 */
@Injectable()
export class CheckinService {
  private readonly appOrigin: string;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.appOrigin = config.get('APP_ORIGIN', { infer: true });
  }

  /** The owner's paid, live events whose window is open or opens within 24 h (SCR-30). */
  async scanEvents(ownerId: string): Promise<ScanEventView[]> {
    const rows = await this.dataSource.getRepository(Event).find({
      where: { ownerId, paymentStatus: EventPaymentStatus.PAID },
      order: { admissionOpensAt: 'ASC' },
    });
    const now = Date.now();
    return rows
      .filter(
        (event) =>
          isLive(event) &&
          event.admissionClosesAt.getTime() > now &&
          event.admissionOpensAt.getTime() <= now + DAY_MS,
      )
      .map((event) => ({
        id: event.id,
        name: event.name,
        startsAt: event.startsAt.toISOString(),
        admissionOpensAt: event.admissionOpensAt.toISOString(),
        admissionClosesAt: event.admissionClosesAt.toISOString(),
        isOpen: isOpen(event, now),
      }));
  }

  async stats(ownerId: string, eventId: string): Promise<ScanStats> {
    await this.ownedEvent(ownerId, eventId);
    return this.counts(eventId);
  }

  async checkIn(
    ownerId: string,
    eventId: string,
    raw: string,
  ): Promise<CheckInResponse> {
    const event = await this.ownedEvent(ownerId, eventId);
    const result = await this.admit(ownerId, event, raw);
    const { admitted } = await this.counts(eventId);
    return { ...result, admittedCount: admitted };
  }

  /** SCR-40. Unknown, revoked and declined codes are all 404: the hash is gone or never existed. */
  async publicInvitation(token: string): Promise<PublicInvitationView> {
    if (!TOKEN.test(token)) throw notFound();
    const [row] = await this.dataSource.query<
      {
        guest_name: string;
        rsvp: GuestRsvp;
        checked_in_at: Date | null;
        event_name: string;
        starts_at: Date;
        venue_name: string;
        venue_map_url: string | null;
        status: EventStatus;
        admission_closes_at: Date;
      }[]
    >(
      `SELECT g.name AS guest_name, g.rsvp, g.checked_in_at, e.name AS event_name, e.starts_at,
              e.venue_name, e.venue_map_url, e.status, e.admission_closes_at
         FROM guests g JOIN events e ON e.id = g.event_id
        WHERE g.qr_token_hash = $1 AND g.deleted_at IS NULL`,
      [hashQrToken(token)],
    );
    if (!row || row.rsvp !== GuestRsvp.ACCEPTED) throw notFound();
    const closed =
      row.status === EventStatus.CANCELLED ||
      row.status === EventStatus.CLOSED ||
      row.admission_closes_at.getTime() <= Date.now();
    return {
      guestName: row.guest_name,
      eventName: row.event_name,
      startsAt: row.starts_at.toISOString(),
      venueName: row.venue_name,
      venueMapUrl: row.venue_map_url,
      status: row.checked_in_at ? 'ADMITTED' : closed ? 'CLOSED' : 'VALID',
      checkedInAt: row.checked_in_at?.toISOString() ?? null,
      qrSvg: closed ? null : await renderQrSvg(qrUrl(this.appOrigin, token)),
    };
  }

  private async admit(
    ownerId: string,
    event: Event,
    raw: string,
  ): Promise<Omit<CheckInResponse, 'admittedCount'>> {
    if (!isLive(event) || !isOpen(event, Date.now()))
      return { result: 'WINDOW_CLOSED' };
    const token = extractToken(raw);
    if (!token) return { result: 'INVALID' };
    const hash = hashQrToken(token);

    const [updated] = await this.dataSource.query<
      [{ name: string; checked_in_at: Date }[], number]
    >(
      `UPDATE guests SET checked_in_at = now(), checked_in_by_user_id = $3, updated_at = now()
        WHERE event_id = $1 AND qr_token_hash = $2 AND rsvp = $4
          AND checked_in_at IS NULL AND deleted_at IS NULL
        RETURNING name, checked_in_at`,
      [event.id, hash, ownerId, GuestRsvp.ACCEPTED],
    );
    if (updated[0])
      return {
        result: 'ADMITTED',
        guestName: updated[0].name,
        checkedInAt: updated[0].checked_in_at.toISOString(),
      };

    const [guest] = await this.dataSource.query<
      {
        event_id: string;
        name: string;
        rsvp: GuestRsvp;
        checked_in_at: Date | null;
        deleted_at: Date | null;
      }[]
    >(
      `SELECT event_id, name, rsvp, checked_in_at, deleted_at FROM guests WHERE qr_token_hash = $1`,
      [hash],
    );
    if (!guest || guest.deleted_at) return { result: 'INVALID' };
    // Another event, whoever owns it: no details leak to this owner.
    if (guest.event_id !== event.id) return { result: 'WRONG_EVENT' };
    if (guest.checked_in_at)
      return {
        result: 'ALREADY_ADMITTED',
        guestName: guest.name,
        checkedInAt: guest.checked_in_at.toISOString(),
      };
    if (guest.rsvp !== GuestRsvp.ACCEPTED)
      return { result: 'NOT_ACCEPTED', guestName: guest.name };
    return { result: 'INVALID' };
  }

  /** 404 for another owner's event, as for every owner endpoint. */
  private async ownedEvent(ownerId: string, eventId: string): Promise<Event> {
    const event = await this.dataSource
      .getRepository(Event)
      .findOneBy({ id: eventId, ownerId });
    if (!event) throw notFound();
    return event;
  }

  private async counts(eventId: string): Promise<ScanStats> {
    const [row] = await this.dataSource.query<
      { admitted: number; accepted: number }[]
    >(
      `SELECT count(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS admitted,
              count(*) FILTER (WHERE rsvp = $2)::int AS accepted
         FROM guests WHERE event_id = $1 AND deleted_at IS NULL`,
      [eventId, GuestRsvp.ACCEPTED],
    );
    return row;
  }
}

const isLive = (event: Event) =>
  event.paymentStatus === EventPaymentStatus.PAID &&
  event.status !== EventStatus.CANCELLED &&
  event.status !== EventStatus.CLOSED;

const isOpen = (event: Event, now: number) =>
  event.admissionOpensAt.getTime() <= now &&
  now < event.admissionClosesAt.getTime();
