import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type Redis from 'ioredis';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../../config/env.validation';
import { REDIS } from '../../auth/services/rate-limit.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

const LOCK_KEY = 'lock:whatsapp:sweep';
const LOCK_TTL_MS = 2 * 60_000;

/**
 * Every 30 s: stale `SENDING` claims become `UNKNOWN`, then queued intents that were not sent
 * inline (crash, retry-later) are sent. Claims are conditional, so the Redis lock only avoids
 * wasted work between the blue and green containers. Replaced by BullMQ workers in T-P3-05.
 */
@Injectable()
export class WhatsappSweeperJob {
  private readonly logger = new Logger(WhatsappSweeperJob.name);
  private readonly enabled: boolean;

  constructor(
    private readonly sender: WhatsappSenderService,
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    // Tests call run() directly so timing never decides an assertion.
    this.enabled = config.get('NODE_ENV', { infer: true }) !== NodeEnv.Test;
  }

  @Interval('whatsapp-sweeper', 30_000)
  async tick(): Promise<void> {
    if (!this.enabled) return;
    const locked = await this.redis
      .set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX')
      .catch(() => null);
    if (locked !== 'OK') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`WhatsApp sweep failed: ${(error as Error).message}`);
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  async run(settleMs?: number): Promise<{ stale: number; sent: number }> {
    const stale = await this.sender.recoverStale();
    const sent = await this.sender.processQueued(50, settleMs);
    return { stale, sent };
  }
}
