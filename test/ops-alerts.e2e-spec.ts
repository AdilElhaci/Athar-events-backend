import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  Event,
  EventCampaignStatus,
  EventPaymentStatus,
  EventStatus,
} from '../src/modules/events/entities/event.entity';
import { Guest, GuestKind } from '../src/modules/guests/entities/guest.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
import { HEARTBEAT_WORKER } from '../src/modules/invitations/whatsapp/whatsapp-queue.service';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { OpsAlertsService } from '../src/modules/ops/ops-alerts.service';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

class CapturingMail {
  sent: Array<{ to: string; message: MailMessage }> = [];
  sendLater(to: string, message: MailMessage) {
    this.sent.push({ to, message });
  }
  send(to: string, message: MailMessage) {
    this.sent.push({ to, message });
    return Promise.resolve();
  }
}

describe('Operations alerts by e-mail (e2e, T-P5-07)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let redis: Redis;
  let mail: CapturingMail;
  let alerts: OpsAlertsService;
  let ownerId: string;
  let phoneSeq = 0;

  const createEvent = (overrides: Partial<Event> = {}) => {
    const startsAt = overrides.startsAt ?? new Date(Date.now() + 10 * DAY);
    return db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة',
        startsAt,
        venueName: 'قاعة الضيافة',
        packageName: 'فرحة',
        invitationAllowance: 50,
        extraMargin: 5,
        priceHalalas: 150_000,
        currency: 'SAR',
        status: EventStatus.ACTIVE,
        paymentStatus: EventPaymentStatus.PAID,
        admissionOpensAt: new Date(startsAt.getTime() - 3_600_000),
        admissionClosesAt: new Date(startsAt.getTime() + 3_600_000),
        ...overrides,
      }),
    );
  };

  const messages = async (eventId: string, states: WhatsappMessageState[]) => {
    for (const state of states) {
      const guest = await db.getRepository(Guest).save(
        db.getRepository(Guest).create({
          eventId,
          name: 'ضيف',
          phone: `+9665${String(++phoneSeq).padStart(8, '0')}`,
          kind: GuestKind.INITIAL,
        }),
      );
      await db.getRepository(WhatsappMessage).insert({
        eventId,
        guestId: guest.id,
        kind: WhatsappMessageKind.INVITATION,
        logicalKey: `invitation:${guest.id}:1`,
        state,
      });
    }
  };

  const ids = (list: { id: string }[]) => list.map((a) => a.id).sort();

  beforeAll(async () => {
    mail = new CapturingMail();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
    db = app.get(DataSource);
    await db.dropDatabase();
    await db.runMigrations();
    redis = app.get(REDIS);
    alerts = app.get(OpsAlertsService);
    app.get(ConfigService).set('OPS_ALERT_EMAIL', 'ops@example.com');
    app
      .get(ConfigService)
      .set('WHATSAPP_INVITATION_TEMPLATE_STATUS', 'APPROVED');
    ownerId = (
      await db.getRepository(User).save(
        db.getRepository(User).create({
          type: UserType.OWNER,
          status: UserStatus.ACTIVE,
          name: 'صاحب المناسبة',
          email: 'owner@example.com',
        }),
      )
    ).id;
  });

  beforeEach(async () => {
    await redis.flushdb();
    await redis.set(HEARTBEAT_WORKER, String(Date.now()));
    await db.query(
      'TRUNCATE events, whatsapp_messages, guests, payment_attempts CASCADE',
    );
    mail.sent = [];
  });

  afterAll(async () => {
    await app.close();
  });

  it('is quiet when everything is healthy', async () => {
    const quiet = await alerts.check();
    // The test machine's disk may be full; nothing else may fire.
    expect(ids(quiet).filter((id) => id !== 'disk_full')).toEqual([]);
  });

  it('reports each operations.md condition with counts and reference codes only', async () => {
    const overdue = await createEvent({
      campaignStatus: EventCampaignStatus.SCHEDULED,
      sendAt: new Date(Date.now() - 10 * MINUTE),
    });
    const failing = await createEvent({
      campaignStatus: EventCampaignStatus.SENDING,
    });
    await messages(failing.id, [
      ...Array<WhatsappMessageState>(17).fill(WhatsappMessageState.SENT),
      ...Array<WhatsappMessageState>(3).fill(WhatsappMessageState.FAILED),
    ]);
    await messages(failing.id, [WhatsappMessageState.UNKNOWN]);
    const attempt = (status: string, failureCode: string | null, ago: number) =>
      db.query(
        `INSERT INTO payment_attempts (id, event_id, owner_id, amount, currency, status, failure_code, created_at)
         VALUES (gen_random_uuid(), $1, $2, 150000, 'SAR', $3, $4, now() - ($5 || ' minutes')::interval)`,
        [failing.id, ownerId, status, failureCode, ago],
      );
    await attempt('FAILED', 'duplicate_payment', 5);
    await attempt('PENDING', null, 45);
    await attempt('PENDING', null, 5); // too young to worry about
    await redis.set(HEARTBEAT_WORKER, String(Date.now() - 10 * MINUTE));
    app
      .get(ConfigService)
      .set('WHATSAPP_INVITATION_TEMPLATE_STATUS', 'PENDING');

    const found = await alerts.check();
    app
      .get(ConfigService)
      .set('WHATSAPP_INVITATION_TEMPLATE_STATUS', 'APPROVED');
    expect(ids(found).filter((id) => id !== 'disk_full')).toEqual([
      'overdue_campaigns',
      'payments_to_refund',
      'send_failures',
      'stuck_payments',
      'template_not_approved',
      'unknown_sends',
      'worker_down',
    ]);
    const byId = Object.fromEntries(found.map((a) => [a.id, a.detail]));
    expect(byId.overdue_campaigns).toContain(overdue.referenceCode);
    expect(byId.send_failures).toContain(failing.referenceCode);
    expect(byId.unknown_sends).toContain('1 ');
    expect(byId.stuck_payments).toContain('1 ');
    expect(byId.worker_down).toContain('10 دقيقة');
  });

  it('e-mails a new alert once, repeats it only after 6 hours, and re-arms once it clears', async () => {
    await createEvent({
      campaignStatus: EventCampaignStatus.SCHEDULED,
      sendAt: new Date(Date.now() - 10 * MINUTE),
    });
    const first = await alerts.run();
    expect(ids(first)).toContain('overdue_campaigns');
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe('ops@example.com');
    expect(mail.sent[0].message.kind).toBe('ops_alert');
    expect(mail.sent[0].message.text).toContain('حملات تأخر إرسالها');
    // No owner or guest data in the message.
    expect(mail.sent[0].message.html).not.toContain('زفاف نورة');
    expect(mail.sent[0].message.html).not.toContain('owner@example.com');

    expect(await alerts.run()).toEqual([]);
    expect(mail.sent).toHaveLength(1);
    expect(await redis.ttl('alert:overdue_campaigns')).toBeGreaterThan(
      6 * 3600 - 60,
    );

    await db.query(`UPDATE events SET campaign_status = 'SENDING'`);
    await alerts.run();
    expect(await redis.exists('alert:overdue_campaigns')).toBe(0);
    await db.query(`UPDATE events SET campaign_status = 'SCHEDULED'`);
    expect(ids(await alerts.run())).toContain('overdue_campaigns');
    expect(mail.sent).toHaveLength(2);
  });

  it('only logs when no alert address is configured', async () => {
    app.get(ConfigService).set('OPS_ALERT_EMAIL', '');
    await redis.del(HEARTBEAT_WORKER);
    const sent = await alerts.run();
    app.get(ConfigService).set('OPS_ALERT_EMAIL', 'ops@example.com');
    expect(ids(sent)).toContain('worker_down');
    expect(mail.sent).toHaveLength(0);
  });
});
