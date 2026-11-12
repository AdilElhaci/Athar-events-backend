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
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { PaymentAttempt } from '../src/modules/payments/entities/payment-attempt.entity';
import {
  MoyasarClient,
  MoyasarError,
} from '../src/modules/payments/moyasar.client';
import { FakeMoyasarClient } from '../src/modules/payments/testing/fake-moyasar.client';
import { User } from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const SECRET = process.env.MOYASAR_WEBHOOK_SECRET!;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);
let phoneSeq = 0;

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

describe('Admin payments, refunds and the action log (e2e, T-P2-09)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let moyasar: FakeMoyasarClient;
  let db: DataSource;
  let redis: Redis;
  const access: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const as = (who: string, req: request.Test) =>
    req.set('Authorization', `Bearer ${access[who]}`);
  const adminGet = (path: string) => as('admin', server().get(`/api${path}`));
  const adminPost = (path: string, body: object = {}) =>
    csrf(as('admin', server().post(`/api${path}`))).send(body);
  const eventOf = (id: string) =>
    db.getRepository(Event).findOneByOrFail({ id });
  const attemptOf = (id: string) =>
    db.getRepository(PaymentAttempt).findOneByOrFail({ id });

  function createEvent(overrides: Partial<Event> = {}) {
    const startsAt = overrides.startsAt ?? inDays(30);
    return db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId: ids.owner,
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

  /** The owner opens an invoice and pays it on the fake hosted page; nothing is applied yet. */
  async function paidAtMoyasar(eventId: string) {
    const res = await csrf(
      as('owner', server().post(`/api/events/${eventId}/checkout`)),
    ).expect(200);
    const attempt = await attemptOf(
      (res.body as { data: { paymentAttemptId: string } }).data
        .paymentAttemptId,
    );
    const payment = moyasar.pay(attempt.moyasarInvoiceId!);
    return { attempt, payment };
  }

  const paidWebhook = (payment: { id: string }) =>
    server()
      .post('/api/payments/moyasar/webhook')
      .send({
        id: `evt_${payment.id}`,
        type: 'payment_paid',
        secret_token: SECRET,
        live: false,
        data: payment,
      })
      .expect(200);

  async function register(who: string, email: string) {
    await csrf(server().post('/api/auth/register/start'))
      .send({ email, name: 'سارة العتيبي' })
      .expect(200);
    const code = /(\d{6})/.exec(mail.sent.at(-1)!.message.text)![1];
    const verify = await csrf(server().post('/api/auth/register/verify'))
      .send({ email, code })
      .expect(200);
    const res = await csrf(server().post('/api/auth/register/complete'))
      .send({
        registrationToken: verify.body.data.registrationToken,
        password: PASSWORD,
      })
      .expect(200);
    access[who] = res.body.data.accessToken;
    ids[who] = (await db.getRepository(User).findOneByOrFail({ email })).id;
  }

  beforeAll(async () => {
    mail = new CapturingMail();
    moyasar = new FakeMoyasarClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(MoyasarClient)
      .useValue(moyasar)
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
    await register('owner', 'owner@example.com');

    await app
      .get(AdminProvisioningService)
      .provision('admin@example.com', 'المدير', { promote: false });
    const invite = mail.sent
      .map((m) => /#token=([\w-]+)/.exec(m.message.text)?.[1])
      .find(Boolean);
    await csrf(server().post('/api/auth/accept-invite'))
      .send({ token: invite, password: PASSWORD })
      .expect(200);
    const login = await csrf(server().post('/api/auth/login'))
      .send({ email: 'admin@example.com', password: PASSWORD })
      .expect(200);
    access.admin = login.body.data.accessToken;
    ids.admin = (
      await db
        .getRepository(User)
        .findOneByOrFail({ email: 'admin@example.com' })
    ).id;
  });

  beforeEach(async () => {
    await redis.flushdb();
    await db.query('TRUNCATE events, webhook_receipts CASCADE');
    await db.query('DELETE FROM admin_actions');
    moyasar.invoices.clear();
    moyasar.failNext = null;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists attempts with event and owner, filters and searches; admins only (SCR-26)', async () => {
    const paid = await createEvent({ name: 'حفل التخرج' });
    const pending = await createEvent({ name: 'زفاف ريم' });
    const { payment } = await paidAtMoyasar(paid.id);
    await paidWebhook(payment);
    await csrf(
      as('owner', server().post(`/api/events/${pending.id}/checkout`)),
    ).expect(200);

    const all = await adminGet('/admin/payments').expect(200);
    expect(all.body.data.meta.total).toBe(2);
    const row = all.body.data.items.find(
      (p: { event: { id: string } }) => p.event.id === paid.id,
    );
    expect(row).toMatchObject({
      status: 'PAID',
      amount: 150_000,
      currency: 'SAR',
      refundNeeded: false,
      card: { brand: 'mada', last4: '3333' },
      event: { name: 'حفل التخرج', paymentStatus: 'PAID' },
      owner: { id: ids.owner, email: 'owner@example.com' },
    });
    expect(row.owner).not.toHaveProperty('passwordHash');

    const pendingOnly = await adminGet('/admin/payments?status=PENDING').expect(
      200,
    );
    expect(
      pendingOnly.body.data.items.map(
        (p: { event: { id: string } }) => p.event.id,
      ),
    ).toEqual([pending.id]);
    const search = await adminGet(
      `/admin/payments?search=${encodeURIComponent(paid.referenceCode)}`,
    ).expect(200);
    expect(search.body.data.meta.total).toBe(1);

    await as('owner', server().get('/api/admin/payments')).expect(403);
  });

  it('reconciles a pending attempt with Moyasar on demand, audited', async () => {
    const event = await createEvent();
    const { attempt } = await paidAtMoyasar(event.id);

    moyasar.failNext = new MoyasarError('down', 503);
    const down = await adminPost(
      `/admin/payments/${attempt.id}/reconcile`,
    ).expect(503);
    expect(down.body.code).toBe('payments.provider_unavailable');
    expect((await attemptOf(attempt.id)).status).toBe('PENDING');

    const res = await adminPost(
      `/admin/payments/${attempt.id}/reconcile`,
    ).expect(200);
    expect(res.body.data).toMatchObject({ status: 'PAID' });
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PAID,
    );
    const again = await adminPost(
      `/admin/payments/${attempt.id}/reconcile`,
    ).expect(409);
    expect(again.body.code).toBe('payments.not_pending');

    const audit = await db
      .getRepository(AdminAction)
      .findOneByOrFail({ action: 'payment.reconcile', targetId: attempt.id });
    expect(audit).toMatchObject({
      actorUserId: ids.admin,
      targetType: 'payment',
      summary: { eventId: event.id, from: 'PENDING', to: 'PAID' },
    });
  });

  it('flags a payment taken but not applied until an admin records its refund', async () => {
    const event = await createEvent();
    const first = await paidAtMoyasar(event.id);
    await db.getRepository(PaymentAttempt).update(first.attempt.id, {
      expiresAt: new Date(Date.now() + MINUTE_MS),
    });
    const second = await paidAtMoyasar(event.id);
    await paidWebhook(first.payment);
    await paidWebhook(second.payment);

    const flagged = await adminGet('/admin/payments?needsAction=true').expect(
      200,
    );
    expect(flagged.body.data.items).toHaveLength(1);
    expect(flagged.body.data.items[0]).toMatchObject({
      id: second.attempt.id,
      failureCode: 'duplicate_payment',
      refundNeeded: true,
      refundedAt: null,
    });
    const dash = await adminGet('/admin/dashboard').expect(200);
    expect(dash.body.data.alerts.paymentsToRefund).toBe(1);

    await adminPost(`/admin/payments/${second.attempt.id}/refund-done`, {
      reason: 'x',
    }).expect(400);
    const done = await adminPost(
      `/admin/payments/${second.attempt.id}/refund-done`,
      { reason: 'أُعيد المبلغ من لوحة ميسّر' },
    ).expect(200);
    expect(done.body.data.refundNeeded).toBe(false);
    expect(done.body.data.refundedAt).toEqual(expect.any(String));
    expect(
      (await adminGet('/admin/dashboard').expect(200)).body.data.alerts
        .paymentsToRefund,
    ).toBe(0);
    const twice = await adminPost(
      `/admin/payments/${second.attempt.id}/refund-done`,
      { reason: 'مرة أخرى' },
    ).expect(409);
    expect(twice.body.code).toBe('payments.no_refund_needed');
    // The paid event is untouched by recording the stray refund.
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PAID,
    );
  });

  it('marks a paid event refunded: cancels it, its queued messages and every QR code (AC-05-5)', async () => {
    const event = await createEvent();
    const { attempt, payment } = await paidAtMoyasar(event.id);
    await paidWebhook(payment);
    await db
      .getRepository(Event)
      .update(event.id, { campaignStatus: EventCampaignStatus.SENDING });
    const guest = (qr: boolean) =>
      db.getRepository(Guest).save(
        db.getRepository(Guest).create({
          eventId: event.id,
          name: 'ضيف',
          phone: `+9665${String(++phoneSeq).padStart(8, '0')}`,
          kind: GuestKind.INITIAL,
          qrTokenHash: qr ? 'a'.repeat(63) + String(phoneSeq % 10) : null,
        }),
      );
    const g1 = await guest(true);
    const g2 = await guest(true);
    const g3 = await guest(false);
    const intent = (guestId: string, state: WhatsappMessageState) =>
      db.getRepository(WhatsappMessage).save(
        db.getRepository(WhatsappMessage).create({
          eventId: event.id,
          guestId,
          kind: WhatsappMessageKind.INVITATION,
          logicalKey: `invitation:${guestId}:1`,
          state,
        }),
      );
    await intent(g3.id, WhatsappMessageState.QUEUED);
    await intent(g1.id, WhatsappMessageState.SENT);

    const short = await adminPost(`/admin/events/${event.id}/mark-refunded`, {
      reason: 'لا',
    }).expect(400);
    expect(short.body.code).toBe('common.validation');
    await csrf(
      as('owner', server().post(`/api/admin/events/${event.id}/mark-refunded`)),
    )
      .send({ reason: 'استرجاع' })
      .expect(403);

    const res = await adminPost(`/admin/events/${event.id}/mark-refunded`, {
      reason: 'طلب العميل الإلغاء قبل الإرسال',
    }).expect(200);
    expect(res.body.code).toBe('events.refunded');
    expect(await eventOf(event.id)).toMatchObject({
      status: EventStatus.CANCELLED,
      paymentStatus: EventPaymentStatus.REFUNDED,
      campaignStatus: EventCampaignStatus.CANCELLED,
    });
    const guests = await db
      .getRepository(Guest)
      .findBy([{ id: g1.id }, { id: g2.id }]);
    expect(guests.every((g) => g.qrTokenHash === null)).toBe(true);
    const states = await db
      .getRepository(WhatsappMessage)
      .find({ where: { eventId: event.id }, order: { createdAt: 'ASC' } });
    expect(states.map((m) => [m.state, m.lastErrorCode])).toEqual([
      ['CANCELLED', 'event_refunded'],
      ['SENT', null],
    ]);
    expect((await attemptOf(attempt.id)).metadata.refundedAt).toEqual(
      expect.any(String),
    );
    // A refunded paid attempt is not a payment awaiting refund.
    const flagged = await adminGet('/admin/payments?needsAction=true').expect(
      200,
    );
    expect(flagged.body.data.items).toHaveLength(0);

    const again = await adminPost(`/admin/events/${event.id}/mark-refunded`, {
      reason: 'مرة أخرى',
    }).expect(409);
    expect(again.body.code).toBe('events.not_paid');
    const unpaid = await createEvent();
    await adminPost(`/admin/events/${unpaid.id}/mark-refunded`, {
      reason: 'غير مدفوعة',
    }).expect(409);

    const audit = await db
      .getRepository(AdminAction)
      .findOneByOrFail({ action: 'event.refunded', targetId: event.id });
    expect(audit.summary).toEqual({
      reason: 'طلب العميل الإلغاء قبل الإرسال',
      paymentAttemptId: attempt.id,
      previousCampaign: 'SENDING',
      messagesCancelled: 1,
      qrRevoked: 2,
    });
  });

  it('lists the action log newest first with the actor, filtered by event and action (SCR-28)', async () => {
    const event = await createEvent();
    const { attempt } = await paidAtMoyasar(event.id);
    await adminPost(`/admin/payments/${attempt.id}/reconcile`).expect(200);
    await adminPost(`/admin/events/${event.id}/mark-refunded`, {
      reason: 'إلغاء من العميل',
    }).expect(200);
    const other = await createEvent();
    await db.getRepository(AdminAction).insert({
      actorUserId: null,
      action: 'admin.created',
      targetType: 'user',
      targetId: ids.admin,
      summary: {},
    });

    const all = await adminGet('/admin/actions').expect(200);
    expect(all.body.data.meta.total).toBe(3);
    expect(all.body.data.items[0]).toMatchObject({
      action: 'admin.created',
      actor: null,
    });

    const forEvent = await adminGet(
      `/admin/actions?eventId=${event.id}`,
    ).expect(200);
    expect(
      forEvent.body.data.items.map((a: { action: string }) => a.action),
    ).toEqual(['event.refunded', 'payment.reconcile']);
    expect(forEvent.body.data.items[0].actor).toEqual({
      id: ids.admin,
      name: 'المدير',
      email: 'admin@example.com',
    });
    expect(
      (await adminGet(`/admin/actions?eventId=${other.id}`).expect(200)).body
        .data.meta.total,
    ).toBe(0);

    const byAction = await adminGet(
      '/admin/actions?action=payment.reconcile',
    ).expect(200);
    expect(byAction.body.data.meta.total).toBe(1);
    await adminGet('/admin/actions?action=DROP%20TABLE').expect(400);

    const names = await adminGet('/admin/actions/names').expect(200);
    expect(names.body.data).toEqual([
      'admin.created',
      'event.refunded',
      'payment.reconcile',
    ]);
    await as('owner', server().get('/api/admin/actions')).expect(403);
  });
});
