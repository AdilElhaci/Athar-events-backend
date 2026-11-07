import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  EntityManager,
  IsNull,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { escapeLike } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import {
  CreateGuestDto,
  GuestCounts,
  GuestsQueryDto,
  UpdateGuestDto,
} from './dto/guest.dto';
import {
  Guest,
  GuestAllocationStatus,
  GuestKind,
  GuestSource,
} from './entities/guest.entity';
import { validateGuest } from './utils/guest-sheet';

/** Once sending is scheduled or running, the list is frozen (SP-04 owns later changes). */
const FROZEN_CAMPAIGN = [
  EventCampaignStatus.SCHEDULED,
  EventCampaignStatus.SENDING,
  EventCampaignStatus.PAUSED,
  EventCampaignStatus.SENT,
];

export const isUniqueViolation = (error: unknown) =>
  error instanceof QueryFailedError &&
  (error.driverError as { code?: string })?.code === '23505';

/**
 * Admin guest writes and list readiness (SP-03 §4). Every write takes the event row lock first,
 * so quota checks and inserts for one event never interleave (data-model.md, quota invariants).
 */
@Injectable()
export class GuestsService {
  constructor(
    @InjectRepository(Guest) private readonly guests: Repository<Guest>,
    @InjectRepository(Event) private readonly events: Repository<Event>,
    private readonly dataSource: DataSource,
  ) {}

  async list(
    eventId: string,
    { page, limit, search, kind, rsvp, admitted }: GuestsQueryDto,
    { phoneSearch }: { phoneSearch: boolean },
  ): Promise<[Guest[], number]> {
    const qb = this.guests
      .createQueryBuilder('g')
      .where('g.eventId = :eventId', { eventId })
      .andWhere('g.deletedAt IS NULL');
    const term = search?.trim();
    if (term)
      qb.andWhere(
        new Brackets((where) => {
          where.where("g.name ILIKE :term ESCAPE '\\'", {
            term: `%${escapeLike(term)}%`,
          });
          // Owners see masked numbers, so they cannot probe by phone.
          const digits = term.replace(/\D/g, '').replace(/^0/, '');
          if (phoneSearch && digits.length >= 3)
            where.orWhere('g.phone LIKE :digits', { digits: `%${digits}%` });
        }),
      );
    if (kind) qb.andWhere('g.kind = :kind', { kind });
    if (rsvp) qb.andWhere('g.rsvp = :rsvp', { rsvp });
    if (admitted !== undefined)
      qb.andWhere(
        admitted ? 'g.checkedInAt IS NOT NULL' : 'g.checkedInAt IS NULL',
      );
    return qb
      .orderBy('g.createdAt', 'ASC')
      .addOrderBy('g.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
  }

  async counts(eventId: string): Promise<GuestCounts> {
    const event = await this.events.findOneBy({ id: eventId });
    if (!event) throw notFound();
    return {
      ...(await liveCounts(this.dataSource.manager, eventId)),
      allowance: event.invitationAllowance,
      extraMargin: event.extraMargin,
    };
  }

  async create(
    actorUserId: string,
    eventId: string,
    dto: CreateGuestDto,
  ): Promise<Guest> {
    const input = checked(dto);
    return this.dataSource.transaction(async (manager) => {
      const event = await lockWritableEvent(manager, eventId);
      await assertPhoneFree(manager, eventId, input.phone);
      await assertRoom(manager, event, input.kind);
      const guest = await saveUnique(
        manager,
        manager.create(Guest, {
          eventId,
          ...input,
          source: GuestSource.MANUAL,
        }),
      );
      await markInProgress(manager, event);
      await audit(manager, actorUserId, 'guests.create', eventId, {
        guestId: guest.id,
        kind: guest.kind,
      });
      return guest;
    });
  }

  async update(
    actorUserId: string,
    eventId: string,
    guestId: string,
    dto: UpdateGuestDto,
  ): Promise<Guest> {
    return this.dataSource.transaction(async (manager) => {
      const event = await lockWritableEvent(manager, eventId);
      const guest = await findLiveGuest(manager, eventId, guestId);
      const input = checked({
        name: dto.name ?? guest.name,
        phone: dto.phone ?? guest.phone ?? '',
        kind: dto.kind ?? guest.kind,
        note: dto.note === undefined ? (guest.note ?? '') : dto.note,
      });
      const fields = (['name', 'phone', 'kind', 'note'] as const).filter(
        (field) => input[field] !== guest[field],
      );
      if (!fields.length) return guest;

      if (fields.includes('phone')) {
        if (guest.allocationStatus === GuestAllocationStatus.ALLOCATED)
          throw conflict('guests.locked_after_allocation');
        await assertPhoneFree(manager, eventId, input.phone, guest.id);
      }
      if (fields.includes('kind')) await assertRoom(manager, event, input.kind);

      const saved = await saveUnique(manager, Object.assign(guest, input));
      await audit(manager, actorUserId, 'guests.update', eventId, {
        guestId,
        fields,
      });
      return saved;
    });
  }

  async remove(
    actorUserId: string,
    eventId: string,
    guestId: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockWritableEvent(manager, eventId);
      const guest = await findLiveGuest(manager, eventId, guestId);
      if (guest.allocationStatus === GuestAllocationStatus.ALLOCATED)
        throw conflict('guests.locked_after_allocation');
      await manager.update(Guest, { id: guest.id }, { deletedAt: new Date() });

      // A "ready" list that lost its last initial guest is no longer ready.
      if (
        event.listStatus === EventListStatus.READY &&
        (await liveCounts(manager, eventId)).initial === 0
      )
        await manager.update(
          Event,
          { id: eventId },
          { listStatus: EventListStatus.IN_PROGRESS },
        );
      await audit(manager, actorUserId, 'guests.delete', eventId, {
        guestId,
        kind: guest.kind,
      });
    });
  }

  /**
   * `READY` hands the event to approval and scheduling (stage `awaiting_approval`); it needs at
   * least one initial guest. Going back to `IN_PROGRESS` is allowed until the invitation is
   * approved or sending is scheduled.
   */
  async setListStatus(
    actorUserId: string,
    eventId: string,
    status: EventListStatus.IN_PROGRESS | EventListStatus.READY,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await lockWritableEvent(manager, eventId);
      if (event.listStatus === status) return;
      if (status === EventListStatus.READY) {
        if ((await liveCounts(manager, eventId)).initial === 0)
          throw unprocessable('guests.ready_requires_guest');
      } else if (event.approvalStatus === EventApprovalStatus.APPROVED)
        throw conflict('guests.list_locked');

      await manager.update(Event, { id: eventId }, { listStatus: status });
      await audit(manager, actorUserId, 'event.list_status', eventId, {
        from: event.listStatus,
        to: status,
      });
    });
  }
}

function checked(input: {
  name: string;
  phone: string;
  kind?: string;
  note?: string;
}) {
  const result = validateGuest(input);
  if (result.reason) throw unprocessable(result.reason);
  return {
    name: result.name!,
    phone: result.phone!,
    kind: result.kind!,
    note: result.note,
  };
}

/** Locks the event row for the rest of the transaction and checks guest writes are open. */
export async function lockWritableEvent(
  manager: EntityManager,
  eventId: string,
): Promise<Event> {
  const event = await manager.findOne(Event, {
    where: { id: eventId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!event) throw notFound();
  if (
    event.status === EventStatus.CANCELLED ||
    event.status === EventStatus.CLOSED
  )
    throw conflict('events.closed');
  if (event.paymentStatus !== EventPaymentStatus.PAID)
    throw unprocessable('guests.event_unpaid');
  if (FROZEN_CAMPAIGN.includes(event.campaignStatus))
    throw conflict('guests.list_locked');
  return event;
}

export async function liveCounts(
  manager: EntityManager,
  eventId: string,
): Promise<{ initial: number; reserve: number }> {
  const rows = await manager
    .createQueryBuilder(Guest, 'g')
    .select('g.kind', 'kind')
    .addSelect('COUNT(*)::int', 'count')
    .where('g.eventId = :eventId AND g.deletedAt IS NULL', { eventId })
    .groupBy('g.kind')
    .getRawMany<{ kind: GuestKind; count: number }>();
  const of = (kind: GuestKind) => rows.find((r) => r.kind === kind)?.count ?? 0;
  return { initial: of(GuestKind.INITIAL), reserve: of(GuestKind.RESERVE) };
}

/** Call with the event row locked. AC-04-3: initial ≤ allowance, reserve ≤ margin. */
async function assertRoom(
  manager: EntityManager,
  event: Event,
  kind: GuestKind,
): Promise<void> {
  const counts = await liveCounts(manager, event.id);
  if (kind === GuestKind.INITIAL && counts.initial >= event.invitationAllowance)
    throw unprocessable('guests.allowance_exceeded');
  if (kind === GuestKind.RESERVE && counts.reserve >= event.extraMargin)
    throw unprocessable('guests.reserve_exceeded');
}

async function assertPhoneFree(
  manager: EntityManager,
  eventId: string,
  phone: string,
  exceptId?: string,
): Promise<void> {
  const existing = await manager.findOneBy(Guest, {
    eventId,
    phone,
    deletedAt: IsNull(),
  });
  if (existing && existing.id !== exceptId)
    throw conflict('guests.phone_duplicate');
}

async function findLiveGuest(
  manager: EntityManager,
  eventId: string,
  guestId: string,
): Promise<Guest> {
  const guest = await manager.findOneBy(Guest, {
    id: guestId,
    eventId,
    deletedAt: IsNull(),
  });
  if (!guest) throw notFound();
  return guest;
}

/** The partial unique index is the backstop for the phone check. */
async function saveUnique(manager: EntityManager, guest: Guest) {
  try {
    return await manager.save(guest);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('guests.phone_duplicate');
    throw error;
  }
}

/** The first guest change moves the owner's view to "we are preparing your list". */
export async function markInProgress(
  manager: EntityManager,
  event: Event,
): Promise<void> {
  if (event.listStatus === EventListStatus.AWAITING_LIST)
    await manager.update(
      Event,
      { id: event.id },
      { listStatus: EventListStatus.IN_PROGRESS },
    );
}

/** Ids, kinds and counts only: never names or phones (data-model.md, admin_actions). */
export const audit = (
  manager: EntityManager,
  actorUserId: string,
  action: string,
  eventId: string,
  summary: Record<string, unknown>,
) =>
  manager.save(AdminAction, {
    actorUserId,
    action,
    targetType: 'event',
    targetId: eventId,
    summary,
  });
