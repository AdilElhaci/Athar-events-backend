import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, LessThan, Repository } from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { escapeLike } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  AdminDashboardView,
  AdminEventsQueryDto,
  AdminUpdateEventDto,
} from './dto/admin-event.dto';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventStatus,
} from './entities/event.entity';
import {
  ACTION_STAGES,
  EVENT_STAGES,
  EventStage,
  STAGE_SQL,
} from './event-stage';
import { assertFutureStart, assertSendTime } from './events.service';

/** Matches the "Overdue campaign" alert in operations.md. */
const OVERDUE_AFTER_MS = 5 * 60_000;

/** Changing these makes an approved invitation out of date (D-15). */
const MATERIAL_FIELDS = ['name', 'startsAt', 'venueName', 'venueMapUrl'];

const sameValue = (a: unknown, b: unknown) =>
  a instanceof Date && b instanceof Date
    ? a.getTime() === b.getTime()
    : a === b;

@Injectable()
export class AdminEventsService {
  constructor(
    @InjectRepository(Event) private readonly events: Repository<Event>,
    private readonly dataSource: DataSource,
  ) {}

  async dashboard(): Promise<AdminDashboardView> {
    const [rows, overdueCampaigns] = await Promise.all([
      this.events
        .createQueryBuilder('e')
        .select(STAGE_SQL, 'stage')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('stage')
        .getRawMany<{ stage: EventStage; count: number }>(),
      this.events.countBy({
        campaignStatus: EventCampaignStatus.SCHEDULED,
        sendAt: LessThan(new Date(Date.now() - OVERDUE_AFTER_MS)),
      }),
    ]);
    const stages = Object.fromEntries(
      EVENT_STAGES.map((stage) => [stage, 0]),
    ) as Record<EventStage, number>;
    for (const { stage, count } of rows) stages[stage] = count;
    return { stages, alerts: { overdueCampaigns } };
  }

  async list({
    page,
    limit,
    search,
    stage,
    needsAction,
  }: AdminEventsQueryDto): Promise<[(readonly [Event, EventStage])[], number]> {
    const qb = this.withOwner();
    const term = search?.trim();
    if (term) {
      qb.andWhere(
        new Brackets((where) =>
          where
            .where("e.name ILIKE :term ESCAPE '\\'")
            .orWhere("e.referenceCode ILIKE :term ESCAPE '\\'")
            .orWhere("owner.name ILIKE :term ESCAPE '\\'"),
        ),
        { term: `%${escapeLike(term)}%` },
      );
    }
    if (stage) qb.andWhere(`(${STAGE_SQL}) = :stage`, { stage });
    if (needsAction)
      qb.andWhere(`(${STAGE_SQL}) IN (:...actionStages)`, {
        actionStages: ACTION_STAGES,
      });

    const total = await qb.getCount();
    const rows = await this.withStage(
      qb
        .orderBy('e.startsAt', needsAction ? 'ASC' : 'DESC')
        .addOrderBy('e.id', 'ASC')
        .offset((page - 1) * limit)
        .limit(limit),
    );
    return [rows, total];
  }

  async get(id: string): Promise<readonly [Event, EventStage]> {
    const [row] = await this.withStage(
      this.withOwner().where('e.id = :id', { id }),
    );
    if (!row) throw notFound();
    return row;
  }

  /** Audited correction. Unlike an owner edit it stays open after approval and scheduling (SP-02). */
  async correct(
    actorUserId: string,
    id: string,
    { reason, ...dto }: AdminUpdateEventDto,
  ): Promise<readonly [Event, EventStage]> {
    await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) throw notFound();
      if (
        event.status === EventStatus.CANCELLED ||
        event.status === EventStatus.CLOSED
      )
        throw conflict('events.closed');

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
      // A corrected date carries the window with it, keeping any custom hours.
      const shift = startsAt.getTime() - event.startsAt.getTime();
      const next = {
        name: dto.name ?? event.name,
        startsAt,
        venueName: dto.venueName ?? event.venueName,
        venueMapUrl:
          dto.venueMapUrl === undefined ? event.venueMapUrl : dto.venueMapUrl,
        requestedSendAt:
          dto.requestedSendAt === undefined
            ? event.requestedSendAt
            : dto.requestedSendAt
              ? new Date(dto.requestedSendAt)
              : null,
        admissionOpensAt: dto.admissionOpensAt
          ? new Date(dto.admissionOpensAt)
          : new Date(event.admissionOpensAt.getTime() + shift),
        admissionClosesAt: dto.admissionClosesAt
          ? new Date(dto.admissionClosesAt)
          : new Date(event.admissionClosesAt.getTime() + shift),
      };
      const fields = (Object.keys(next) as (keyof typeof next)[]).filter(
        (field) => !sameValue(next[field], event[field]),
      );
      if (!fields.length) return;

      if (shift) assertFutureStart(startsAt);
      if (fields.includes('requestedSendAt'))
        assertSendTime(next.requestedSendAt, startsAt);
      for (const sendTime of [next.requestedSendAt, event.sendAt])
        if (sendTime && sendTime.getTime() >= startsAt.getTime())
          throw unprocessable('events.send_after_start');
      if (next.admissionOpensAt.getTime() >= next.admissionClosesAt.getTime())
        throw unprocessable('events.admission_window_invalid');

      const approvalReset =
        event.approvalStatus === EventApprovalStatus.APPROVED &&
        event.campaignStatus !== EventCampaignStatus.SENDING &&
        event.campaignStatus !== EventCampaignStatus.SENT &&
        fields.some((field) => MATERIAL_FIELDS.includes(field));

      await manager.save(
        Object.assign(event, next, {
          approvalStatus: approvalReset
            ? EventApprovalStatus.AWAITING_OWNER
            : event.approvalStatus,
          // The approved text named the old details: a new version is needed (D-15).
          approvedContentId: approvalReset ? null : event.approvedContentId,
        }),
      );
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'event.corrected',
        targetType: 'event',
        targetId: id,
        summary: { fields, reason, approvalReset },
      });
    });
    return this.get(id);
  }

  /** Only the owner columns the views need: the password hash stays out of memory. */
  private withOwner() {
    return this.events
      .createQueryBuilder('e')
      .innerJoin('e.owner', 'owner')
      .addSelect(['owner.id', 'owner.name', 'owner.email', 'owner.phone']);
  }

  private async withStage(qb: ReturnType<AdminEventsService['withOwner']>) {
    const { raw, entities } = await qb
      .addSelect(STAGE_SQL, 'stage')
      .getRawAndEntities<{ stage: EventStage }>();
    return entities.map((event, i) => [event, raw[i].stage] as const);
  }
}
