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
import { Coupon } from '../src/modules/coupons/entities/coupon.entity';
import {
  Event,
  EventPaymentStatus,
} from '../src/modules/events/entities/event.entity';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { Package } from '../src/modules/packages/entities/package.entity';
import { PaymentAttempt } from '../src/modules/payments/entities/payment-attempt.entity';
import { MoyasarClient } from '../src/modules/payments/moyasar.client';
import { FakeMoyasarClient } from '../src/modules/payments/testing/fake-moyasar.client';
import { User } from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const SECRET = process.env.MOYASAR_WEBHOOK_SECRET!;
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

describe('Coupons (e2e, D-48)', () => {
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
  const createCoupon = (body: object, who = 'admin') =>
    csrf(as(who, server().post('/api/admin/coupons'))).send(body);
  const updateCoupon = (id: string, body: object) =>
    csrf(as('admin', server().patch(`/api/admin/coupons/${id}`))).send(body);
  const apply = (eventId: string, code: string, who = 'owner') =>
    csrf(as(who, server().put(`/api/events/${eventId}/coupon`))).send({
      code,
    });
  const remove = (eventId: string, who = 'owner') =>
    csrf(as(who, server().delete(`/api/events/${eventId}/coupon`)));
  const checkout = (eventId: string) =>
    csrf(as('owner', server().post(`/api/events/${eventId}/checkout`)));
  const eventOf = (id: string) =>
    db.getRepository(Event).findOneByOrFail({ id });
  const couponOf = (code: string) =>
    db.getRepository(Coupon).findOneByOrFail({ code });

  async function createEvent(owner = 'owner', overrides: Partial<Event> = {}) {
    const startsAt = inDays(30);
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
  });

  beforeEach(async () => {
    await redis.flushdb();
    await db.query('TRUNCATE events, webhook_receipts, coupons CASCADE');
    moyasar.invoices.clear();
    moyasar.created = [];
    moyasar.configured = true;
    moyasar.failNext = null;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets admins create and stop coupons, never owners', async () => {
    const created = await createCoupon({
      code: '  wedding20 ',
      type: 'PERCENT',
      value: 20,
      maxUses: 50,
    }).expect(201);
    expect(created.body.data).toMatchObject({
      code: 'WEDDING20',
      type: 'PERCENT',
      value: 20,
      maxUses: 50,
      usedCount: 0,
      isActive: true,
      expiresAt: null,
    });
    expect(
      (
        await createCoupon({
          code: 'WEDDING20',
          type: 'FIXED',
          value: 500,
        }).expect(409)
      ).body.code,
    ).toBe('coupons.code_taken');
    expect(
      (
        await createCoupon({ code: 'ALL', type: 'PERCENT', value: 100 }).expect(
          422,
        )
      ).body.code,
    ).toBe('coupons.percent_range');
    await createCoupon({ code: 'BAD CODE', type: 'FIXED', value: 500 }).expect(
      400,
    );
    await createCoupon({ code: 'ZERO', type: 'FIXED', value: 0 }).expect(400);
    await createCoupon(
      { code: 'OWNER', type: 'FIXED', value: 500 },
      'owner',
    ).expect(403);

    const stopped = await updateCoupon(created.body.data.id, {
      isActive: false,
      maxUses: null,
    }).expect(200);
    expect(stopped.body.data).toMatchObject({ isActive: false, maxUses: null });

    const list = await as('admin', server().get('/api/admin/coupons')).expect(
      200,
    );
    expect(list.body.data.items).toHaveLength(1);
    expect(
      await db.getRepository(AdminAction).countBy({ targetType: 'coupon' }),
    ).toBe(2);
  });

  it('charges the discounted price and counts the coupon once paid', async () => {
    await createCoupon({
      code: 'WEDDING20',
      type: 'PERCENT',
      value: 20,
    }).expect(201);
    const event = await createEvent();

    const applied = await apply(event.id, 'wedding20').expect(200);
    expect(applied.body.data).toMatchObject({
      coupon: { code: 'WEDDING20', discountHalalas: 30_000 },
      amountDueHalalas: 120_000,
      couponEditable: true,
      package: { priceHalalas: 150_000 },
    });
    await apply(event.id, 'WEDDING20').expect(200); // same coupon again: no change

    const res = await checkout(event.id).expect(200);
    expect(moyasar.created[0]).toMatchObject({ amount: 120_000 });
    expect(moyasar.created[0].description).toContain('كوبون WEDDING20');
    const attempt = await db
      .getRepository(PaymentAttempt)
      .findOneByOrFail({ id: res.body.data.paymentAttemptId });
    expect(attempt.amount).toBe(120_000);

    // An open invoice freezes the coupon.
    expect((await remove(event.id).expect(409)).body.code).toBe(
      'coupons.payment_open',
    );

    const payment = moyasar.pay(attempt.moyasarInvoiceId!);
    await server()
      .post('/api/payments/moyasar/webhook')
      .send({
        id: `evt_${payment.id}`,
        type: 'payment_paid',
        secret_token: SECRET,
        live: false,
        data: payment,
      })
      .expect(200);
    expect((await eventOf(event.id)).paymentStatus).toBe(
      EventPaymentStatus.PAID,
    );
    expect((await couponOf('WEDDING20')).usedCount).toBe(1);
    expect((await apply(event.id, 'WEDDING20').expect(409)).body.code).toBe(
      'events.already_paid',
    );
  });

  it('answers the same refusal for unknown, stopped, expired and used-up codes', async () => {
    const event = await createEvent();
    await createCoupon({
      code: 'STOPPED',
      type: 'FIXED',
      value: 500,
      isActive: false,
    }).expect(201);
    await createCoupon({
      code: 'EXPIRED',
      type: 'FIXED',
      value: 500,
      expiresAt: new Date(Date.now() - DAY_MS).toISOString(),
    }).expect(201);
    await createCoupon({
      code: 'USEDUP',
      type: 'FIXED',
      value: 500,
      maxUses: 1,
    }).expect(201);
    await db.getRepository(Coupon).update({ code: 'USEDUP' }, { usedCount: 1 });

    for (const code of ['NOPE', 'STOPPED', 'EXPIRED', 'USEDUP'])
      expect((await apply(event.id, code).expect(422)).body.code).toBe(
        'coupons.invalid',
      );
    expect((await eventOf(event.id)).couponId).toBeNull();
  });

  it('lets an owner use a coupon on one event only', async () => {
    await createCoupon({ code: 'ONCE', type: 'FIXED', value: 10_000 }).expect(
      201,
    );
    const first = await createEvent();
    const second = await createEvent();
    await apply(first.id, 'ONCE').expect(200);
    expect((await apply(second.id, 'ONCE').expect(409)).body.code).toBe(
      'coupons.already_used',
    );

    // Another owner may use it.
    const others = await createEvent('other');
    await apply(others.id, 'ONCE', 'other').expect(200);

    // Removed from the first event, it can go on the second.
    const removed = await remove(first.id).expect(200);
    expect(removed.body.data).toMatchObject({
      coupon: null,
      amountDueHalalas: 150_000,
    });
    await apply(second.id, 'ONCE').expect(200);
    await apply(first.id, 'ONCE', 'other').expect(404);
  });

  it('keeps at least 1 SAR to pay and reprices on a package change', async () => {
    await createCoupon({ code: 'BIG', type: 'FIXED', value: 900_000 }).expect(
      201,
    );
    await createCoupon({ code: 'HALF', type: 'PERCENT', value: 50 }).expect(
      201,
    );
    const event = await createEvent();
    const big = await apply(event.id, 'BIG').expect(200);
    expect(big.body.data.amountDueHalalas).toBe(100);

    const cheap = await createEvent('owner', { priceHalalas: 100 });
    expect((await apply(cheap.id, 'HALF').expect(422)).body.code).toBe(
      'coupons.not_applicable',
    );

    const pkg = await db.getRepository(Package).save(
      db.getRepository(Package).create({
        name: 'بهجة',
        invitationAllowance: 100,
        extraMargin: 10,
        priceHalalas: 50_000,
        isActive: true,
      }),
    );
    await apply(event.id, 'HALF').expect(200);
    const changed = await csrf(
      as('owner', server().patch(`/api/events/${event.id}`)),
    )
      .send({ packageId: pkg.id })
      .expect(200);
    expect(changed.body.data).toMatchObject({
      package: { priceHalalas: 50_000 },
      coupon: { code: 'HALF', discountHalalas: 25_000 },
      amountDueHalalas: 25_000,
    });
  });

  it('refuses to pay with a coupon stopped after it was applied', async () => {
    const created = await createCoupon({
      code: 'LATE',
      type: 'FIXED',
      value: 5_000,
    }).expect(201);
    const event = await createEvent();
    await apply(event.id, 'LATE').expect(200);
    await updateCoupon(created.body.data.id, { isActive: false }).expect(200);

    expect((await checkout(event.id).expect(422)).body.code).toBe(
      'coupons.no_longer_valid',
    );
    expect(moyasar.created).toHaveLength(0);
    await remove(event.id).expect(200);
    await checkout(event.id).expect(200);
    expect(moyasar.created[0]).toMatchObject({ amount: 150_000 });
  });
});
