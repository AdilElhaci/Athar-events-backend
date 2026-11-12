import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type Redis from 'ioredis';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../../config/env.validation';
import { REDIS } from '../../auth/services/rate-limit.service';
import { WhatsappSweeperJob } from './whatsapp-sweeper.job';

export const WHATSAPP_QUEUE = 'whatsapp';
/** Coalesces triggers: while one sweep job waits, another add with this id is ignored. */
const SWEEP_JOB_ID = 'sweep';
export const HEARTBEAT_SCHEDULER = 'heartbeat:scheduler';
export const HEARTBEAT_WORKER = 'heartbeat:worker';
const HEARTBEAT_TTL_S = 24 * 3600;

/** BullMQ wants its own connections with `maxRetriesPerRequest: null`. */
export function bullConnection(url: string): ConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export const hasRole = (
  config: ConfigService<EnvironmentVariables, true>,
  role: 'api' | 'worker' | 'scheduler',
) => config.get('PROCESS_ROLES', { infer: true }).split(',').includes(role);

/**
 * D-09: PostgreSQL rows are the queue's truth; BullMQ jobs only say "run a sending pass" and
 * carry no data, so duplicates and lost jobs are harmless. Writers trigger a pass right after
 * their transaction commits; a campaign's start is a delayed job at `send_at`; every 30 s the
 * scheduler adds one anyway (the sweeper), and runs the pass itself if Redis refuses the job.
 */
@Injectable()
export class WhatsappQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappQueue.name);
  private queue?: Queue;
  private worker?: Worker;
  private readonly isTest: boolean;

  constructor(
    private readonly sweeper: WhatsappSweeperJob,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.isTest = config.get('NODE_ENV', { infer: true }) === NodeEnv.Test;
  }

  onModuleInit(): void {
    const connection = bullConnection(
      this.config.get('REDIS_URL', { infer: true }),
    );
    this.queue = new Queue(WHATSAPP_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 1,
      },
    });
    this.queue.on('error', (error) =>
      this.logger.warn(`Queue connection: ${error.message}`),
    );
    // Tests call the sweeper directly so timing never decides an assertion.
    if (this.isTest || !hasRole(this.config, 'worker')) return;
    this.worker = new Worker(WHATSAPP_QUEUE, () => this.process(), {
      connection,
      concurrency: 1,
    });
    this.worker.on('error', (error) =>
      this.logger.warn(`Worker connection: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  /** Ask for a sending pass now. Never throws: the 30 s sweeper is the backstop. */
  async trigger(reason: string): Promise<void> {
    await this.add(reason, { jobId: SWEEP_JOB_ID });
  }

  /** A pass at `sendAt` so the campaign starts on time; a newer schedule simply adds another. */
  async scheduleStart(
    eventId: string,
    scheduleVersion: number,
    sendAt: Date,
  ): Promise<void> {
    await this.add('campaign-due', {
      jobId: `due:${eventId}:${scheduleVersion}`,
      delay: Math.max(0, sendAt.getTime() - Date.now()),
    });
  }

  @Interval('whatsapp-sweeper', 30_000)
  async tick(): Promise<void> {
    if (this.isTest || !hasRole(this.config, 'scheduler')) return;
    await this.beat(HEARTBEAT_SCHEDULER);
    const queued = await this.add('sweeper', { jobId: SWEEP_JOB_ID });
    // Redis refused the job: send from here rather than wait for it to come back.
    if (!queued) await this.sweeper.runLocked();
  }

  /** The worker's job: one pass, and another straight away if work was left over. */
  async process(): Promise<void> {
    await this.beat(HEARTBEAT_WORKER);
    const result = await this.sweeper.runLocked();
    if (result?.more) await this.add('more', {});
  }

  private async add(
    reason: string,
    opts: { jobId?: string; delay?: number },
  ): Promise<boolean> {
    if (!this.queue) return false;
    try {
      await this.queue.add('sweep', { reason }, opts);
      return true;
    } catch (error) {
      this.logger.warn(
        `Could not queue a sending pass (${reason}): ${(error as Error).message}`,
      );
      return false;
    }
  }

  private beat(key: string): Promise<unknown> {
    return this.redis
      .set(key, String(Date.now()), 'EX', HEARTBEAT_TTL_S)
      .catch(() => undefined);
  }
}
