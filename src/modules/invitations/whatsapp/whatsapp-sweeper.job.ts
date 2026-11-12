import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../auth/services/rate-limit.service';
import { CampaignSenderService } from './campaign-sender.service';
import { WhatsappSenderService } from './whatsapp-sender.service';

const LOCK_KEY = 'lock:whatsapp:sweep';
const LOCK_TTL_MS = 2 * 60_000;
export const CHUNK = 50;
/** One pass stops taking new chunks after this, well inside the lock TTL. */
const PASS_BUDGET_MS = 20_000;

export interface SweepResult {
  stale: number;
  started: number;
  sent: number;
  completed: number;
  /** The pass stopped on its time budget with a full chunk: more is probably queued. */
  more: boolean;
}

/**
 * One sending pass (SP-04 §4): stale `SENDING` claims become `UNKNOWN`; started events cancel what
 * is still queued; due campaigns create their intents; queued intents are sent in chunks of 50;
 * finished campaigns become `SENT`. Run by the BullMQ worker (`WhatsappQueue`). Claims are
 * conditional, so the Redis lock only avoids wasted work between processes.
 */
@Injectable()
export class WhatsappSweeperJob {
  private readonly logger = new Logger(WhatsappSweeperJob.name);

  constructor(
    private readonly sender: WhatsappSenderService,
    private readonly campaigns: CampaignSenderService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** A pass under the lock; null when another process holds it (that pass covers this one). */
  async runLocked(): Promise<SweepResult | null> {
    const locked = await this.redis
      .set(LOCK_KEY, '1', 'PX', LOCK_TTL_MS, 'NX')
      .catch(() => null);
    if (locked !== 'OK') return null;
    try {
      return await this.run();
    } catch (error) {
      this.logger.error(`WhatsApp sweep failed: ${(error as Error).message}`);
      return null;
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  async run(settleMs?: number): Promise<SweepResult> {
    const stale = await this.sender.recoverStale();
    await this.campaigns.cancelStarted();
    const started = await this.campaigns.startDue();
    const deadline = Date.now() + PASS_BUDGET_MS;
    let sent = 0;
    let more = false;
    for (;;) {
      const chunk = await this.sender.processQueued(CHUNK, settleMs);
      sent += chunk;
      if (chunk < CHUNK) break;
      if (Date.now() >= deadline) {
        more = true;
        break;
      }
    }
    const completed = await this.campaigns.completeFinished();
    return { stale, started, sent, completed, more };
  }
}
