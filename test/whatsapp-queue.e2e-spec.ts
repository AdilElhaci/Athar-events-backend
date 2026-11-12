import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  bullConnection,
  HEARTBEAT_WORKER,
  WHATSAPP_QUEUE,
  WhatsappQueue,
} from '../src/modules/invitations/whatsapp/whatsapp-queue.service';
import { WhatsappSweeperJob } from '../src/modules/invitations/whatsapp/whatsapp-sweeper.job';

/** D-09: BullMQ jobs only trigger a sending pass; the rows stay the truth. */
describe('WhatsApp queue triggers (e2e, T-P3-05)', () => {
  let app: NestExpressApplication;
  let redis: Redis;
  let probe: Queue;
  let service: WhatsappQueue;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
    redis = app.get(REDIS);
    service = app.get(WhatsappQueue);
    probe = new Queue(WHATSAPP_QUEUE, {
      connection: bullConnection(app.get(ConfigService).get('REDIS_URL')!),
    });
  });

  beforeEach(() => redis.flushdb());

  afterAll(async () => {
    await probe.close();
    await app.close();
  });

  it('coalesces repeated triggers into one waiting pass', async () => {
    await service.trigger('replacements.send');
    await service.trigger('message.resend');
    await service.trigger('campaign.resume');
    expect(await probe.getWaitingCount()).toBe(1);
    const job = await probe.getJob('sweep');
    expect(job?.data).toEqual({ reason: 'replacements.send' });
  });

  it('adds a delayed pass at send_at, one per schedule version', async () => {
    const sendAt = new Date(Date.now() + 10 * 60_000);
    await service.scheduleStart('e1', 3, sendAt);
    await service.scheduleStart('e1', 3, sendAt); // same version: ignored
    await service.scheduleStart('e1', 4, new Date(Date.now() + 60_000));
    expect(await probe.getDelayedCount()).toBe(2);
    const job = await probe.getJob('due:e1:3');
    expect(job!.opts.delay).toBeGreaterThan(9 * 60_000);
    expect(job!.opts.delay).toBeLessThanOrEqual(10 * 60_000);
  });

  it('a job runs one pass under the lock and records the worker heartbeat', async () => {
    const sweeper = app.get(WhatsappSweeperJob);
    const run = jest.spyOn(sweeper, 'run');
    await service.process();
    expect(run).toHaveBeenCalledTimes(1);
    expect(Number(await redis.get(HEARTBEAT_WORKER))).toBeGreaterThan(
      Date.now() - 5_000,
    );

    // Another process holds the lock: its pass covers this job, nothing runs twice.
    await redis.set('lock:whatsapp:sweep', '1', 'PX', 60_000);
    await service.process();
    expect(run).toHaveBeenCalledTimes(1);
    run.mockRestore();
  });

  it('queues another pass straight away when one stopped with work left', async () => {
    const sweeper = app.get(WhatsappSweeperJob);
    const run = jest.spyOn(sweeper, 'run').mockResolvedValue({
      stale: 0,
      started: 0,
      sent: 50,
      completed: 0,
      more: true,
    });
    await service.process();
    expect(await probe.getWaitingCount()).toBe(1);
    run.mockRestore();
  });
});
