import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { Between, LessThan, Repository } from 'typeorm';
import { REDIS } from '../auth/services/rate-limit.service';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from './entities/payment-attempt.entity';
import { PaymentApplyService } from './payment-apply.service';

const MINUTE_MS = 60_000;
const SETTLE_MS = 2 * MINUTE_MS;
const GIVE_UP_MS = 48 * 60 * MINUTE_MS;
const BATCH = 50;
const LOCK_KEY = 'lock:payments:reconcile';
const LOCK_TTL_MS = 4 * MINUTE_MS;

/**
 * Catches payments whose webhook and callback never arrived (AC-05-4): pending attempts between
 * 2 minutes and 48 hours old are checked with Moyasar; older ones are expired. A Redis lock keeps
 * the blue and green containers from running it twice at once (the apply path is idempotent anyway).
 */
@Injectable()
export class PaymentsReconcileJob {
  private readonly logger = new Logger(PaymentsReconcileJob.name);

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attempts: Repository<PaymentAttempt>,
    private readonly apply: PaymentApplyService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'payments-reconcile' })
  async tick(): Promise<void> {
    const locked = await this.redis
      .set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX')
      .catch(() => null);
    if (locked !== 'OK') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Reconciliation failed: ${(error as Error).message}`);
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  /** One pass; returns how many attempts it looked at. */
  async run(now = Date.now()): Promise<number> {
    const stale = await this.attempts.find({
      where: {
        status: PaymentAttemptStatus.PENDING,
        createdAt: LessThan(new Date(now - GIVE_UP_MS)),
      },
      take: BATCH,
    });
    for (const attempt of stale) await this.apply.expire(attempt.id);

    const pending = await this.attempts.find({
      where: {
        status: PaymentAttemptStatus.PENDING,
        createdAt: Between(
          new Date(now - GIVE_UP_MS),
          new Date(now - SETTLE_MS),
        ),
      },
      order: { lastReconciledAt: { direction: 'ASC', nulls: 'FIRST' } },
      take: BATCH,
    });
    for (const attempt of pending) {
      try {
        await this.apply.refresh(attempt);
      } catch (error) {
        this.logger.warn(
          `Reconcile attempt ${attempt.id}: ${(error as Error).message}`,
        );
      }
    }
    return stale.length + pending.length;
  }
}
