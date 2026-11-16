import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import {
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  Event,
  EventPaymentStatus,
  EventStatus,
} from '../events/entities/event.entity';
import { isUniqueViolation } from '../guests/guests.service';
import { couponUsable, discountFor } from './coupon-pricing';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';
import { Coupon, CouponType } from './entities/coupon.entity';

/** D-48 coupons: the admin catalogue, and the owner applying one to an unpaid event. */
@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon) private readonly coupons: Repository<Coupon>,
    private readonly dataSource: DataSource,
  ) {}

  list(page: number, limit: number): Promise<[Coupon[], number]> {
    return this.coupons.findAndCount({
      order: { createdAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async create(actorUserId: string, dto: CreateCouponDto): Promise<Coupon> {
    if (dto.type === CouponType.PERCENT && dto.value > 99)
      throw unprocessable('coupons.percent_range');
    try {
      return await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(Coupon, {
            code: dto.code,
            type: dto.type,
            value: dto.value,
            maxUses: dto.maxUses ?? null,
            expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
            isActive: dto.isActive ?? true,
          }),
        );
        await manager.insert(AdminAction, {
          actorUserId,
          action: 'coupon.created',
          targetType: 'coupon',
          targetId: created.id,
          summary: { type: created.type, value: created.value },
        });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('coupons.code_taken');
      throw error;
    }
  }

  update(
    actorUserId: string,
    id: string,
    dto: UpdateCouponDto,
  ): Promise<Coupon> {
    return this.dataSource.transaction(async (manager) => {
      const coupon = await manager.findOne(Coupon, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!coupon) throw notFound();
      const fields: string[] = [];
      if (dto.isActive !== undefined) {
        coupon.isActive = dto.isActive;
        fields.push('isActive');
      }
      if (dto.maxUses !== undefined) {
        coupon.maxUses = dto.maxUses;
        fields.push('maxUses');
      }
      if (dto.expiresAt !== undefined) {
        coupon.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
        fields.push('expiresAt');
      }
      if (!fields.length) return coupon;
      const saved = await manager.save(coupon);
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'coupon.updated',
        targetType: 'coupon',
        targetId: id,
        summary: { fields },
      });
      return saved;
    });
  }

  /**
   * Puts a coupon on the owner's unpaid event (replacing any other). Every refusal of the code
   * itself answers the same `coupons.invalid`, so codes cannot be probed.
   */
  async apply(ownerId: string, eventId: string, code: string): Promise<Event> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const event = await this.lockChangeable(manager, ownerId, eventId);
        const coupon = await manager.findOneBy(Coupon, { code });
        if (!coupon || !couponUsable(coupon))
          throw unprocessable('coupons.invalid');
        if (event.couponId === coupon.id) return event;
        const used = await manager.existsBy(Event, {
          ownerId,
          couponId: coupon.id,
          id: Not(eventId),
        });
        if (used) throw conflict('coupons.already_used');
        const discount = discountFor(coupon, event.priceHalalas);
        if (discount <= 0) throw unprocessable('coupons.not_applicable');
        event.couponId = coupon.id;
        event.couponCode = coupon.code;
        event.discountHalalas = discount;
        return manager.save(event);
      });
    } catch (error) {
      // Two events of one owner took the same coupon at once: the index kept one.
      if (isUniqueViolation(error)) throw conflict('coupons.already_used');
      throw error;
    }
  }

  remove(ownerId: string, eventId: string): Promise<Event> {
    return this.dataSource.transaction(async (manager) => {
      const event = await this.lockChangeable(manager, ownerId, eventId);
      if (!event.couponId) return event;
      event.couponId = null;
      event.couponCode = null;
      event.discountHalalas = 0;
      return manager.save(event);
    });
  }

  /**
   * The price may change only while no invoice exists: an open invoice keeps the amount it was
   * opened with, so changing the coupon then would let the owner pay one price and keep another.
   */
  private async lockChangeable(
    manager: EntityManager,
    ownerId: string,
    eventId: string,
  ): Promise<Event> {
    const event = await manager.findOne(Event, {
      where: { id: eventId, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!event) throw notFound();
    if (event.paymentStatus === EventPaymentStatus.PAID)
      throw conflict('events.already_paid');
    if (
      event.paymentStatus === EventPaymentStatus.REFUNDED ||
      (event.status !== EventStatus.DRAFT &&
        event.status !== EventStatus.ACTIVE)
    )
      throw conflict('events.closed');
    if (event.paymentStatus === EventPaymentStatus.PENDING)
      throw conflict('coupons.payment_open');
    return event;
  }
}
