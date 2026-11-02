import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  Event,
  EventPaymentStatus,
  EventStatus,
} from '../src/modules/events/entities/event.entity';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from '../src/modules/payments/entities/payment-attempt.entity';
import { WebhookReceipt } from '../src/modules/payments/entities/webhook-receipt.entity';
import {
  MoyasarClient,
  MoyasarError,
} from '../src/modules/payments/moyasar.client';
import { PaymentsReconcileJob } from '../src/modules/payments/payments-reconcile.job';
import { FakeMoyasarClient } from '../src/modules/payments/testing/fake-moyasar.client';
import { User } from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const SECRET = process.env.MOYASAR_WEBHOOK_SECRET!;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
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

describe('Payments (e2e)', () => {
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
  const checkout = (eventId: string, who = 'owner') =>
    csrf(as(who, server().post(`/api/events/${eventId}/checkout`)));
  const status = (eventId: string, attemptId?: string) =>
    as(
      'owner',
      server().get(
        `/api/events/${eventId}/payment-status${attemptId ? `?paymentAttemptId=${attemptId}` : ''}`,
      ),
    );
  const webhook = (body: object) =>
    server().post('/api/payments/moyasar/webhook').send(body);
  const paidWebhook = (
    payment: { id: string; invoice_id?: string | null },
    type = 'payment_paid',
  ) =>
    webhook({
      id: `evt_${payment.id}_${type}`,
      type,
      secret_token: SECRET,
      live: false,
      data: payment,
    });
  const callback = (body: object) =>
    server().post('/api/payments/moyasar/invoice-callback').send(body);
  const eventOf = (id: string) =>
    db.getRepository(Event).findOneByOrFail({ id });
  const attemptOf = (id: string) =>
    db.getRepository(PaymentAttempt).findOneByOrFail({ id });

  async function createEvent(owner = 'owner', overrides: Partial<Event> = {}) {
    const startsAt = overrides.startsAt ?? inDays(30);
    return db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId: ids[owner],
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

  /** Checkout, then the owner pays on the fake hosted page. */
  async function paidCheckout(eventId: string) {
    const res = await checkout(eventId).expect(200);
    const attempt = await attemptOf(res.body.data.paymentAttemptId);
    const payment = moyasar.pay(attempt.moyasarInvoiceId!);
    return { attempt, payment };
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
    await register('other', 'other@example.com');
  });

  beforeEach(async () => {
    await redis.flushdb();
    await db.query('TRUNCATE events, webhook_receipts CASCADE');
    moyasar.invoices.clear();
    moyasar.created = [];
    moyasar.fetches = 0;
    moyasar.configured = true;
    moyasar.failNext = null;
  });

  afterAll(async () => {
    await app.close();
  });

  it('opens a hosted invoice for the snapshot price and reuses it (AC-05-1)', async () => {
    const event = await createEvent();
    const first = await checkout(event.id).expect(200);
    const { paymentUrl, paymentAttemptId } = first.body.data;
    expect(paymentUrl).toMatch(/^https:\/\/checkout\.moyasar\.com\//);

    const [input] = moyasar.created;
    expect(input).toMatchObject({
      amount: 150_000,
      currency: 'SAR',
      metadata: { paymentAttemptId, eventId: event.id },
      successUrl: `${ORIGIN}/dashboard/events/${event.id}/payment?attemptId=${paymentAttemptId}`,
      backUrl: `${ORIGIN}/dashboard/events/${event.id}`,
    });
    expect(input.callbackUrl).toBeUndefined(); // http origin: Moyasar could not reach it
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PENDING,
    );

    const again = await checkout(event.id).expect(200);
    expect(again.body.data).toEqual({ paymentUrl, paymentAttemptId });
    expect(moyasar.created).toHaveLength(1);

    // AC-04-2: the package is frozen once checkout has started.
    await csrf(as('owner', server().patch(`/api/events/${event.id}`)))
      .send({ packageId: '6f1c2f4e-3d4b-4f55-9a10-1c9a7a4b2e11' })
      .expect(409);
  });

  it('opens one invoice when the owner clicks twice at once', async () => {
    const event = await createEvent();
    const [a, b] = await Promise.all([
      checkout(event.id).expect(200),
      checkout(event.id).expect(200),
    ]);
    expect(a.body.data.paymentAttemptId).toBe(b.body.data.paymentAttemptId);
    expect(moyasar.created).toHaveLength(1);
  });

  it("hides other owners' events and refuses closed or started ones", async () => {
    const event = await createEvent();
    await checkout(event.id, 'other').expect(404);
    await status(event.id)
      .set('Authorization', `Bearer ${access.other}`)
      .expect(404);

    const cancelled = await createEvent('owner', {
      status: EventStatus.CANCELLED,
    });
    expect((await checkout(cancelled.id).expect(409)).body.code).toBe(
      'events.closed',
    );

    const started = await createEvent('owner', {
      startsAt: new Date(Date.now() - MINUTE_MS),
    });
    await checkout(started.id).expect(422);
    expect(moyasar.created).toHaveLength(0);
  });

  it('answers 503 and changes nothing when Moyasar is not configured or down', async () => {
    const event = await createEvent();
    moyasar.configured = false;
    expect((await checkout(event.id).expect(503)).body.code).toBe(
      'payments.unavailable',
    );
    moyasar.configured = true;
    moyasar.failNext = new MoyasarError('timeout');
    await checkout(event.id).expect(503);

    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.UNPAID,
    );
    expect(await db.getRepository(PaymentAttempt).count()).toBe(0);
  });

  it('activates the event from a verified webhook, once (AC-05-2, AC-05-3)', async () => {
    const event = await createEvent();
    const { attempt, payment } = await paidCheckout(event.id);

    const first = await paidWebhook(payment).expect(200);
    expect(first.body.data.outcome).toBe('paid');
    const paid = await eventOf(event.id);
    expect(paid).toMatchObject({
      paymentStatus: EventPaymentStatus.PAID,
      status: EventStatus.ACTIVE,
    });
    expect(paid.paidAt).not.toBeNull();
    const stored = await attemptOf(attempt.id);
    expect(stored).toMatchObject({
      status: PaymentAttemptStatus.PAID,
      moyasarPaymentId: payment.id,
      metadata: { sourceType: 'creditcard', brand: 'mada', last4: '3333' },
    });

    const fetches = moyasar.fetches;
    const replay = await paidWebhook(payment).expect(200);
    expect(replay.body.data.outcome).toBe('duplicate');
    expect(moyasar.fetches).toBe(fetches);
    expect((await eventOf(event.id)).paidAt).toEqual(paid.paidAt);
    expect(await db.getRepository(WebhookReceipt).count()).toBe(1);

    await checkout(event.id).expect(409);
  });

  it('refuses webhooks without the shared secret (401)', async () => {
    const event = await createEvent();
    const { payment } = await paidCheckout(event.id);
    const body = { id: 'evt_1', type: 'payment_paid', data: payment };
    await webhook(body).expect(401);
    await webhook({ ...body, secret_token: 'wrong' }).expect(401);
    await webhook({ ...body, secret_token: SECRET.slice(0, -1) + 'x' }).expect(
      401,
    );
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PENDING,
    );
    expect(await db.getRepository(WebhookReceipt).count()).toBe(0);
  });

  it('retries a webhook that failed while Moyasar was unreachable', async () => {
    const event = await createEvent();
    const { payment } = await paidCheckout(event.id);
    moyasar.failNext = new MoyasarError('timeout');
    await paidWebhook(payment).expect(500);
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PENDING,
    );

    const retry = await paidWebhook(payment).expect(200);
    expect(retry.body.data.outcome).toBe('paid');
  });

  it('acts on the re-fetched invoice, never on the callback body', async () => {
    const event = await createEvent();
    await checkout(event.id).expect(200);
    const [invoiceId] = [...moyasar.invoices.keys()];

    // A forged "paid" callback for an invoice Moyasar still reports as unpaid.
    await callback({ id: invoiceId, status: 'paid', amount: 150_000 }).expect(
      200,
    );
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PENDING,
    );

    // Ids that are not ours are not even fetched.
    const fetches = moyasar.fetches;
    expect(
      (await callback({ id: 'inv_unknown' }).expect(200)).body.data.outcome,
    ).toBe('unknown_invoice');
    expect(moyasar.fetches).toBe(fetches);

    moyasar.pay(invoiceId);
    await callback({ id: invoiceId }).expect(200);
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PAID,
    );
  });

  it('confirms a payment on the return page by asking Moyasar', async () => {
    const event = await createEvent();
    const res = await checkout(event.id).expect(200);
    const attemptId = res.body.data.paymentAttemptId;

    expect((await status(event.id, attemptId).expect(200)).body.data).toEqual({
      paymentStatus: 'PENDING',
      attemptStatus: 'PENDING',
    });
    moyasar.pay((await attemptOf(attemptId)).moyasarInvoiceId!);
    await db.getRepository(PaymentAttempt).update(attemptId, {
      lastReconciledAt: null,
    });
    expect((await status(event.id, attemptId).expect(200)).body.data).toEqual({
      paymentStatus: 'PAID',
      attemptStatus: 'PAID',
    });
  });

  it('does not activate when the paid amount or reference does not match', async () => {
    const event = await createEvent();
    const { attempt, payment } = await paidCheckout(event.id);
    const invoice = moyasar.invoice(attempt.moyasarInvoiceId!);
    invoice.amount = 100;
    invoice.payments![0].amount = 100;

    await paidWebhook(payment).expect(200);
    expect(await attemptOf(attempt.id)).toMatchObject({
      status: PaymentAttemptStatus.FAILED,
      failureCode: 'mismatch',
    });
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.UNPAID,
    );

    const other = await createEvent();
    const second = await paidCheckout(other.id);
    moyasar.invoice(second.attempt.moyasarInvoiceId!).metadata = {
      paymentAttemptId: attempt.id,
    };
    await paidWebhook(second.payment).expect(200);
    expect((await attemptOf(second.attempt.id)).failureCode).toBe('mismatch');
    expect((await eventOf(other.id)).paymentStatus).toBe(
      EventPaymentStatus.UNPAID,
    );
  });

  it('keeps the event pending after a declined card, and frees it when the invoice expires', async () => {
    const event = await createEvent();
    const res = await checkout(event.id).expect(200);
    const attempt = await attemptOf(res.body.data.paymentAttemptId);

    const declined = moyasar.fail(attempt.moyasarInvoiceId!);
    await paidWebhook(declined, 'payment_failed').expect(200);
    expect((await attemptOf(attempt.id)).status).toBe(
      PaymentAttemptStatus.PENDING,
    );

    moyasar.expire(attempt.moyasarInvoiceId!);
    await callback({ id: attempt.moyasarInvoiceId }).expect(200);
    expect((await attemptOf(attempt.id)).status).toBe(
      PaymentAttemptStatus.EXPIRED,
    );
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.UNPAID,
    );

    const retry = await checkout(event.id).expect(200);
    expect(retry.body.data.paymentAttemptId).not.toBe(attempt.id);
  });

  it('records a second successful payment without applying it', async () => {
    const event = await createEvent();
    const first = await paidCheckout(event.id);
    // The first invoice is about to expire, so a second checkout opens a new one.
    await db.getRepository(PaymentAttempt).update(first.attempt.id, {
      expiresAt: new Date(Date.now() + MINUTE_MS),
    });
    const second = await paidCheckout(event.id);
    expect(second.attempt.id).not.toBe(first.attempt.id);

    await paidWebhook(first.payment).expect(200);
    await paidWebhook(second.payment).expect(200);
    expect(await attemptOf(second.attempt.id)).toMatchObject({
      status: PaymentAttemptStatus.FAILED,
      failureCode: 'duplicate_payment',
      moyasarPaymentId: second.payment.id,
    });
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PAID,
    );
  });

  it('reconciles payments whose webhook never came, and expires old attempts (AC-05-4)', async () => {
    const job = app.get(PaymentsReconcileJob);
    const repo = db.getRepository(PaymentAttempt);

    const quiet = await createEvent();
    const { attempt } = await paidCheckout(quiet.id);
    expect(await job.run()).toBe(0); // under 2 minutes old: left for the webhook
    await repo.update(attempt.id, {
      createdAt: new Date(Date.now() - 10 * MINUTE_MS),
    });
    expect(await job.run()).toBe(1);
    expect((await eventOf(quiet.id)).paymentStatus).toBe(
      EventPaymentStatus.PAID,
    );

    const abandoned = await createEvent();
    const res = await checkout(abandoned.id).expect(200);
    await repo.update(res.body.data.paymentAttemptId, {
      createdAt: new Date(Date.now() - 3 * DAY_MS),
    });
    const fetches = moyasar.fetches;
    await job.run();
    expect(moyasar.fetches).toBe(fetches);
    expect(await attemptOf(res.body.data.paymentAttemptId)).toMatchObject({
      status: PaymentAttemptStatus.EXPIRED,
      failureCode: 'not_confirmed',
    });
    expect((await eventOf(abandoned.id)).paymentStatus).toBe(
      EventPaymentStatus.UNPAID,
    );
  });
});
