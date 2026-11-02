import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminAction } from '../src/modules/admin-actions/admin-action.entity';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from '../src/modules/events/entities/event.entity';
import {
  NextAction,
  nextActionOf,
} from '../src/modules/events/event-next-action';
import { EventStage, STAGE_SQL } from '../src/modules/events/event-stage';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { User } from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const UNKNOWN_ID = '6f1c2f4e-3d4b-4f55-9a10-1c9a7a4b2e11';
const DAY_MS = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);

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

/** The admin column of "Next-step logic" in information-architecture.md. */
const STAGE_OF_ACTION: Record<NextAction, EventStage> = {
  CANCELLED: 'done',
  CLOSED: 'done',
  COMPLETE_PAYMENT: 'awaiting_payment',
  SEND_LIST: 'awaiting_list',
  LIST_IN_PROGRESS: 'awaiting_list',
  APPROVE_INVITATION: 'awaiting_approval',
  AWAITING_SCHEDULE: 'awaiting_approval',
  SCHEDULED: 'scheduled',
  SENDING: 'sending',
  PAUSED: 'needs_attention',
  RESULTS: 'done',
};

describe('Admin events (e2e)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let db: DataSource;
  let redis: Redis;
  let adminAccess: string;
  let ownerAccess: string;
  let ownerId: string;

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminAccess}`);
  const list = (query = '') =>
    asAdmin(server().get(`/api/admin/events${query}`)).expect(200);
  const correct = (id: string, body: object) =>
    csrf(asAdmin(server().patch(`/api/admin/events/${id}`))).send(body);
  const audits = (id: string) =>
    db.getRepository(AdminAction).findBy({ targetId: id });

  async function createEvent(overrides: Partial<Event> = {}) {
    const startsAt = overrides.startsAt ?? inDays(30);
    return db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة',
        startsAt,
        venueName: 'قاعة الضيافة',
        packageName: 'فرحة',
        invitationAllowance: 200,
        extraMargin: 20,
        priceHalalas: 150_000,
        currency: 'SAR',
        admissionOpensAt: new Date(startsAt.getTime() - 3_600_000),
        admissionClosesAt: new Date(startsAt.getTime() + 3_600_000),
        ...overrides,
      }),
    );
  }

  async function login(email: string) {
    const res = await csrf(server().post('/api/auth/login'))
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

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
    await redis.flushdb();

    await app
      .get(AdminProvisioningService)
      .provision('admin@example.com', 'المدير', { promote: false });
    const invite = mail.sent
      .map((m) => /#token=([\w-]+)/.exec(m.message.text)?.[1])
      .find(Boolean);
    await csrf(server().post('/api/auth/accept-invite'))
      .send({ token: invite, password: PASSWORD })
      .expect(200);
    adminAccess = await login('admin@example.com');

    await csrf(server().post('/api/auth/register/start'))
      .send({ email: 'owner@example.com', name: 'سارة العتيبي' })
      .expect(200);
    const code = /(\d{6})/.exec(mail.sent.at(-1)!.message.text)![1];
    const verify = await csrf(server().post('/api/auth/register/verify'))
      .send({ email: 'owner@example.com', code })
      .expect(200);
    const owner = await csrf(server().post('/api/auth/register/complete'))
      .send({
        registrationToken: verify.body.data.registrationToken,
        password: PASSWORD,
      })
      .expect(200);
    ownerAccess = owner.body.data.accessToken;
    ownerId = (
      await db
        .getRepository(User)
        .findOneByOrFail({ email: 'owner@example.com' })
    ).id;
  });

  beforeEach(async () => {
    await redis.flushdb(); // fresh rate-limit counters per test
    await db.query('TRUNCATE events CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a token and 403 to owners', async () => {
    await server().get('/api/admin/dashboard').expect(401);
    for (const path of ['dashboard', 'events', `events/${UNKNOWN_ID}`])
      await server()
        .get(`/api/admin/${path}`)
        .set('Authorization', `Bearer ${ownerAccess}`)
        .expect(403);
  });

  it('gives every state combination the stage of its next action (TC-ADM-01)', async () => {
    const combinations = Object.values(EventStatus).flatMap((status) =>
      Object.values(EventPaymentStatus).flatMap((paymentStatus) =>
        Object.values(EventListStatus).flatMap((listStatus) =>
          Object.values(EventApprovalStatus).flatMap((approvalStatus) =>
            Object.values(EventCampaignStatus).map((campaignStatus) => ({
              status,
              paymentStatus,
              listStatus,
              approvalStatus,
              campaignStatus,
            })),
          ),
        ),
      ),
    );
    const values = combinations
      .map(
        (c, i) =>
          `(${i}, '${c.status}', '${c.paymentStatus}', '${c.listStatus}', '${c.approvalStatus}', '${c.campaignStatus}')`,
      )
      .join(',');
    const rows: { i: number; stage: EventStage }[] = await db.query(
      `SELECT i, ${STAGE_SQL} AS stage
       FROM (VALUES ${values})
         AS e(i, status, payment_status, list_status, approval_status, campaign_status)
       ORDER BY i`,
    );
    expect(rows.map((row) => row.stage)).toEqual(
      combinations.map((c) => STAGE_OF_ACTION[nextActionOf(c)]),
    );
  });

  it('counts stages and overdue campaigns', async () => {
    const paid = {
      status: EventStatus.ACTIVE,
      paymentStatus: EventPaymentStatus.PAID,
    };
    await createEvent();
    await createEvent();
    await createEvent(paid);
    await createEvent({
      ...paid,
      listStatus: EventListStatus.READY,
      campaignStatus: EventCampaignStatus.SCHEDULED,
      sendAt: new Date(Date.now() - 10 * 60_000),
    });
    await createEvent({ status: EventStatus.CANCELLED });

    const res = await asAdmin(server().get('/api/admin/dashboard')).expect(200);
    expect(res.body.data).toEqual({
      stages: {
        awaiting_payment: 2,
        awaiting_list: 1,
        awaiting_approval: 0,
        scheduled: 1,
        sending: 0,
        needs_attention: 0,
        done: 1,
      },
      alerts: { overdueCampaigns: 1 },
    });
  });

  it('filters by stage, tasks and literal search, with stable paging', async () => {
    const paid = {
      status: EventStatus.ACTIVE,
      paymentStatus: EventPaymentStatus.PAID,
    };
    const unpaid = await createEvent({ name: 'تخرج لينا' });
    const later = await createEvent({ ...paid, startsAt: inDays(40) });
    const sooner = await createEvent({ ...paid, startsAt: inDays(10) });

    const stage = await list('?stage=awaiting_payment');
    expect(stage.body.data.items).toHaveLength(1);
    expect(stage.body.data.items[0]).toEqual({
      id: unpaid.id,
      referenceCode: unpaid.referenceCode,
      name: 'تخرج لينا',
      startsAt: unpaid.startsAt.toISOString(),
      ownerName: 'سارة العتيبي',
      packageName: 'فرحة',
      stage: 'awaiting_payment',
      nextAction: 'COMPLETE_PAYMENT',
    });

    const tasks = await list('?needsAction=true');
    expect(
      tasks.body.data.items.map((item: { id: string }) => item.id),
    ).toEqual([sooner.id, later.id]);

    const page = await list('?limit=1&page=2');
    expect(page.body.data.meta).toMatchObject({ total: 3, totalPages: 3 });
    expect(page.body.data.items[0].id).toBe(unpaid.id);

    const byName = await list(`?search=${encodeURIComponent('لينا')}`);
    expect(byName.body.data.meta.total).toBe(1);
    const byOwner = await list(`?search=${encodeURIComponent('العتيبي')}`);
    expect(byOwner.body.data.meta.total).toBe(3);
    const byReference = await list(`?search=${unpaid.referenceCode}`);
    expect(byReference.body.data.meta.total).toBe(1);
    expect((await list('?search=%25')).body.data.meta.total).toBe(0);

    await asAdmin(server().get('/api/admin/events?stage=other')).expect(400);
  });

  it('returns the owner contact without credentials', async () => {
    const event = await createEvent();
    const res = await asAdmin(
      server().get(`/api/admin/events/${event.id}`),
    ).expect(200);
    expect(res.body.data).toMatchObject({
      id: event.id,
      stage: 'awaiting_payment',
      owner: {
        id: ownerId,
        name: 'سارة العتيبي',
        email: 'owner@example.com',
        phone: null,
      },
    });
    expect(Object.keys(res.body.data.owner).sort()).toEqual([
      'email',
      'id',
      'name',
      'phone',
    ]);
    await asAdmin(server().get(`/api/admin/events/${UNKNOWN_ID}`)).expect(404);
  });

  it('records a correction and moves the window with the date', async () => {
    const event = await createEvent();
    const startsAt = inDays(31);
    const res = await correct(event.id, {
      name: 'زفاف نورة وعبدالله',
      startsAt: startsAt.toISOString(),
      reason: 'طلب صاحبة المناسبة',
    }).expect(200);
    expect(res.body.data).toMatchObject({
      name: 'زفاف نورة وعبدالله',
      owner: { id: ownerId },
    });
    expect(new Date(res.body.data.admissionOpensAt).getTime()).toBe(
      startsAt.getTime() - 3_600_000,
    );
    expect(new Date(res.body.data.admissionClosesAt).getTime()).toBe(
      startsAt.getTime() + 3_600_000,
    );

    const [audit] = await audits(event.id);
    expect(audit).toMatchObject({
      action: 'event.corrected',
      targetType: 'event',
      summary: {
        reason: 'طلب صاحبة المناسبة',
        approvalReset: false,
        fields: ['name', 'startsAt', 'admissionOpensAt', 'admissionClosesAt'],
      },
    });
  });

  it('edits the admission window alone and rejects an inverted one', async () => {
    const event = await createEvent();
    await correct(event.id, {
      admissionOpensAt: event.admissionClosesAt.toISOString(),
      admissionClosesAt: event.admissionOpensAt.toISOString(),
      reason: 'تعديل نافذة الدخول',
    })
      .expect(422)
      .expect((res) =>
        expect(res.body.code).toBe('events.admission_window_invalid'),
      );

    const opensAt = new Date(event.admissionOpensAt.getTime() - 3_600_000);
    await correct(event.id, {
      admissionOpensAt: opensAt.toISOString(),
      reason: 'تعديل نافذة الدخول',
    }).expect(200);
    expect((await audits(event.id))[0].summary.fields).toEqual([
      'admissionOpensAt',
    ]);
  });

  it('writes nothing when no value changes', async () => {
    const event = await createEvent();
    await correct(event.id, {
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      reason: 'بدون تغيير',
    }).expect(200);
    expect(await audits(event.id)).toHaveLength(0);
  });

  it('invalidates an approved invitation until sending starts (D-15)', async () => {
    const approved = {
      status: EventStatus.ACTIVE,
      paymentStatus: EventPaymentStatus.PAID,
      listStatus: EventListStatus.READY,
      approvalStatus: EventApprovalStatus.APPROVED,
    };
    const scheduled = await createEvent({
      ...approved,
      campaignStatus: EventCampaignStatus.SCHEDULED,
      sendAt: inDays(5),
    });
    const res = await correct(scheduled.id, {
      venueName: 'قاعة أخرى',
      reason: 'تغيّرت القاعة',
    }).expect(200);
    expect(res.body.data).toMatchObject({
      approvalStatus: 'AWAITING_OWNER',
      stage: 'awaiting_approval',
    });

    const admissionOnly = await createEvent(approved);
    const kept = await correct(admissionOnly.id, {
      admissionOpensAt: inDays(29).toISOString(),
      reason: 'تعديل نافذة الدخول',
    }).expect(200);
    expect(kept.body.data.approvalStatus).toBe('APPROVED');

    const sending = await createEvent({
      ...approved,
      campaignStatus: EventCampaignStatus.SENDING,
      sendAt: inDays(1),
    });
    const running = await correct(sending.id, {
      venueName: 'قاعة أخرى',
      reason: 'تغيّرت القاعة',
    }).expect(200);
    expect(running.body.data.approvalStatus).toBe('APPROVED');
  });

  it('keeps the send times before the event', async () => {
    const event = await createEvent({
      requestedSendAt: new Date(Date.now() - DAY_MS),
      startsAt: inDays(30),
    });
    await correct(event.id, {
      name: 'موعد إرسال مضى لا يمنع التصحيح',
      reason: 'تصحيح الاسم',
    }).expect(200);

    const scheduled = await createEvent({
      paymentStatus: EventPaymentStatus.PAID,
      sendAt: inDays(20),
    });
    await correct(scheduled.id, {
      startsAt: inDays(10).toISOString(),
      reason: 'تقديم الموعد',
    })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('events.send_after_start'));
    await correct(event.id, {
      startsAt: new Date(Date.now() - DAY_MS).toISOString(),
      reason: 'تاريخ قديم',
    })
      .expect(422)
      .expect((res) => expect(res.body.code).toBe('events.starts_in_past'));
  });

  it('refuses closed events, missing reasons, the package and missing CSRF', async () => {
    const cancelled = await createEvent({ status: EventStatus.CANCELLED });
    await correct(cancelled.id, { name: 'اسم جديد', reason: 'تصحيح' })
      .expect(409)
      .expect((res) => expect(res.body.code).toBe('events.closed'));

    const event = await createEvent();
    await correct(event.id, { name: 'اسم جديد' }).expect(400);
    await correct(event.id, { name: 'اسم جديد', reason: '  ' }).expect(400);
    await correct(event.id, {
      packageId: UNKNOWN_ID,
      reason: 'تغيير الباقة',
    }).expect(400);
    await correct(UNKNOWN_ID, { name: 'اسم', reason: 'تصحيح' }).expect(404);
    await asAdmin(server().patch(`/api/admin/events/${event.id}`))
      .send({ name: 'اسم جديد', reason: 'تصحيح' })
      .expect(403);
    expect(await audits(event.id)).toHaveLength(0);
  });
});
