import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, Repository } from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { escapeLike } from '../../shared/pagination';
import { Package } from '../packages/entities/package.entity';
import {
  CreateEventDto,
  isEditable,
  isPackageEditable,
  ListEventsQueryDto,
  UpdateEventDto,
} from './dto/event.dto';
import { Event } from './entities/event.entity';

const HOUR_MS = 3_600_000;
/** Defaults pending OQ-15; admins will be able to correct them per event. */
const ADMISSION_OPENS_BEFORE_MS = 3 * HOUR_MS;
const ADMISSION_CLOSES_AFTER_MS = 12 * HOUR_MS;

const admissionWindow = (startsAt: Date) => ({
  admissionOpensAt: new Date(startsAt.getTime() - ADMISSION_OPENS_BEFORE_MS),
  admissionClosesAt: new Date(startsAt.getTime() + ADMISSION_CLOSES_AFTER_MS),
});

const snapshotOf = (pkg: Package) => ({
  packageId: pkg.id,
  packageName: pkg.name,
  invitationAllowance: pkg.invitationAllowance,
  extraMargin: pkg.extraMargin,
  priceHalalas: pkg.priceHalalas,
  currency: pkg.currency,
});

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event) private readonly events: Repository<Event>,
    private readonly dataSource: DataSource,
  ) {}

  list(
    ownerId: string,
    { page, limit, search, status }: ListEventsQueryDto,
  ): Promise<[Event[], number]> {
    const owned = { ownerId, ...(status ? { status } : {}) };
    const pattern = search && `%${escapeLike(search)}%`;
    return this.events.findAndCount({
      where: pattern
        ? [
            { ...owned, name: ILike(pattern) },
            { ...owned, referenceCode: ILike(pattern) },
          ]
        : owned,
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  /** Other owners' events answer 404: their existence is not disclosed (AC-03-7). */
  async get(ownerId: string, id: string): Promise<Event> {
    const event = await this.events.findOneBy({ id, ownerId });
    if (!event) throw notFound();
    return event;
  }

  async create(ownerId: string, dto: CreateEventDto): Promise<Event> {
    const startsAt = new Date(dto.startsAt);
    const requestedSendAt = dto.requestedSendAt
      ? new Date(dto.requestedSendAt)
      : null;
    this.assertFutureStart(startsAt);
    this.assertSendTime(requestedSendAt, startsAt);

    return this.dataSource.transaction(async (manager) => {
      const pkg = await this.activePackage(manager, dto.packageId);
      const event = manager.create(Event, {
        ownerId,
        name: dto.name,
        startsAt,
        venueName: dto.venueName,
        venueMapUrl: dto.venueMapUrl ?? null,
        requestedSendAt,
        ...snapshotOf(pkg),
        ...admissionWindow(startsAt),
      });
      return manager.save(event);
    });
  }

  update(ownerId: string, id: string, dto: UpdateEventDto): Promise<Event> {
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(Event, {
        where: { id, ownerId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!event) throw notFound();
      if (!isEditable(event)) throw conflict('events.locked');

      const startsAt = dto.startsAt ? new Date(dto.startsAt) : event.startsAt;
      const startChanged = startsAt.getTime() !== event.startsAt.getTime();
      if (startChanged) this.assertFutureStart(startsAt);

      const requestedSendAt =
        dto.requestedSendAt === undefined
          ? event.requestedSendAt
          : dto.requestedSendAt
            ? new Date(dto.requestedSendAt)
            : null;
      if (
        startChanged ||
        requestedSendAt?.getTime() !== event.requestedSendAt?.getTime()
      )
        this.assertSendTime(requestedSendAt, startsAt);

      if (dto.packageId && dto.packageId !== event.packageId) {
        if (!isPackageEditable(event)) throw conflict('events.package_locked');
        Object.assign(
          event,
          snapshotOf(await this.activePackage(manager, dto.packageId)),
        );
      }

      Object.assign(event, {
        name: dto.name ?? event.name,
        venueName: dto.venueName ?? event.venueName,
        venueMapUrl:
          dto.venueMapUrl === undefined ? event.venueMapUrl : dto.venueMapUrl,
        startsAt,
        requestedSendAt,
        ...(startChanged ? admissionWindow(startsAt) : {}),
      });
      return manager.save(event);
    });
  }

  private async activePackage(manager: EntityManager, id: string) {
    const pkg = await manager.findOneBy(Package, { id, isActive: true });
    if (!pkg) throw unprocessable('events.package_inactive');
    return pkg;
  }

  private assertFutureStart(startsAt: Date) {
    if (startsAt.getTime() <= Date.now())
      throw unprocessable('events.starts_in_past');
  }

  private assertSendTime(sendAt: Date | null, startsAt: Date) {
    if (!sendAt) return;
    if (sendAt.getTime() >= startsAt.getTime())
      throw unprocessable('events.send_after_start');
    if (sendAt.getTime() <= Date.now())
      throw unprocessable('events.send_in_past');
  }
}
