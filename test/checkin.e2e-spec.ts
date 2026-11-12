import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import { hashQrToken, newQrToken } from '../src/modules/checkin/qr-token';
import { extractToken } from '../src/modules/checkin/checkin.service';
import {
  Event,
  EventPaymentStatus,
  EventStatus,
} from '../src/modules/events/entities/event.entity';
import { Guest, GuestRsvp } from '../src/modules/guests/entities/guest.entity';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { User } from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const HOUR_MS = 3_600_000;
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

describe('QR check-in and guest page (e2e, SP-05)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let db: DataSource;
  let redis: Redis;
  let adminAccess: string;
  let ownerAccess: string;
  let otherAccess: string;
  let ownerId: string;
  let otherId: string;

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const bearer = (token: string) => (req: request.Test) =>
    req.set('Authorization', `Bearer ${token}`);
  const scan = (eventId: string, token: string, access = ownerAccess) =>
    csrf(
      bearer(access)(server().post(`/api/scan/events/${eventId}/check-ins`)),
    ).send({ token });

  async function login(email: string) {
    const res = await csrf(server().post('/api/auth/login'))
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  async function registerOwner(email: string, name: string) {
    await csrf(server().post('/api/auth/register/start'))
      .send({ email, name })
      .expect(200);
    const code = /(\d{6})/.exec(mail.sent.at(-1)!.message.text)![1];
    const verify = await csrf(server().post('/api/auth/register/verify'))
      .send({ email, code })
      .expect(200);
    const done = await csrf(server().post('/api/auth/register/complete'))
      .send({
        registrationToken: verify.body.data.registrationToken,
        password: PASSWORD,
      })
      .expect(200);
    const user = await db.getRepository(User).findOneByOrFail({ email });
    return { access: done.body.data.accessToken as string, id: user.id };
  }

  /** Admission open by default: started an hour ago, closes in an hour. */
  async function createEvent(overrides: Partial<Event> = {}) {
    const now = Date.now();
    return db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة',
        startsAt: new Date(now + HOUR_MS / 2),
        venueName: 'قاعة الضيافة',
        venueMapUrl: 'https://maps.example.com/q',
        packageName: 'فرحة',
        invitationAllowance: 5,
        extraMargin: 2,
        priceHalalas: 150_000,
        currency: 'SAR',
        status: EventStatus.ACTIVE,
        paymentStatus: EventPaymentStatus.PAID,
        admissionOpensAt: new Date(now - HOUR_MS),
        admissionClosesAt: new Date(now + HOUR_MS),
        ...overrides,
      }),
    );
  }

  /** A guest holding a QR; returns the raw token the guest has on the phone. */
  async function guestWithQr(
    eventId: string,
    rsvp: GuestRsvp = GuestRsvp.ACCEPTED,
  ) {
    const token = newQrToken();
    const guest = await db.getRepository(Guest).save(
      db.getRepository(Guest).create({
        eventId,
        name: 'محمد العتيبي',
        phone: `+9665${String(++phoneSeq).padStart(8, '0')}`,
        rsvp,
        qrTokenHash: hashQrToken(token),
        qrVersion: 1,
        qrIssuedAt: new Date(),
      }),
    );
    return { guest, token };
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
    ({ access: ownerAccess, id: ownerId } = await registerOwner(
      'owner@example.com',
      'سارة العتيبي',
    ));
    ({ access: otherAccess, id: otherId } = await registerOwner(
      'other@example.com',
      'مالك آخر',
    ));
  });

  beforeEach(async () => {
    await redis.flushdb();
    await db.query('TRUNCATE events CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('reads the token from the QR URL or as typed', () => {
    const token = newQrToken();
    expect(extractToken(token)).toBe(token);
    expect(extractToken(`  https://athar.example/i/${token}  `)).toBe(token);
    expect(extractToken(`https://athar.example/i/${token}?x=1`)).toBe(token);
    expect(extractToken('https://athar.example/i/short')).toBeNull();
    expect(extractToken('')).toBeNull();
  });

  it('lists the owner’s paid events whose window is open or within 24 h', async () => {
    const open = await createEvent({ name: 'مفتوحة' });
    const soon = await createEvent({
      name: 'قريبة',
      startsAt: new Date(Date.now() + 6 * HOUR_MS),
      admissionOpensAt: new Date(Date.now() + 5 * HOUR_MS),
      admissionClosesAt: new Date(Date.now() + 8 * HOUR_MS),
    });
    await createEvent({
      name: 'بعيدة',
      startsAt: new Date(Date.now() + 72 * HOUR_MS),
      admissionOpensAt: new Date(Date.now() + 71 * HOUR_MS),
      admissionClosesAt: new Date(Date.now() + 74 * HOUR_MS),
    });
    await createEvent({
      name: 'غير مدفوعة',
      paymentStatus: EventPaymentStatus.UNPAID,
    });
    await createEvent({ name: 'ملغاة', status: EventStatus.CANCELLED });
    await createEvent({ name: 'لمالك آخر', ownerId: otherId });

    const res = await bearer(ownerAccess)(
      server().get('/api/scan/events'),
    ).expect(200);
    expect(
      res.body.data.map((e: { id: string; isOpen: boolean }) => [
        e.id,
        e.isOpen,
      ]),
    ).toEqual([
      [open.id, true],
      [soon.id, false],
    ]);
  });

  it('AC-07-3: admits once, then reports the original time', async () => {
    const event = await createEvent();
    const { guest, token } = await guestWithQr(event.id);

    const first = await scan(event.id, `${ORIGIN}/i/${token}`).expect(200);
    expect(first.body.data).toMatchObject({
      result: 'ADMITTED',
      guestName: 'محمد العتيبي',
      admittedCount: 1,
    });
    const stored = await db
      .getRepository(Guest)
      .findOneByOrFail({ id: guest.id });
    expect(stored.checkedInByUserId).toBe(ownerId);

    const again = await scan(event.id, token).expect(200);
    expect(again.body.data).toMatchObject({
      result: 'ALREADY_ADMITTED',
      guestName: 'محمد العتيبي',
      checkedInAt: first.body.data.checkedInAt,
      admittedCount: 1,
    });

    const stats = await bearer(ownerAccess)(
      server().get(`/api/scan/events/${event.id}/stats`),
    ).expect(200);
    expect(stats.body.data).toEqual({ admitted: 1, accepted: 1 });
  });

  it('TC-QR-03: 20 concurrent scans of one code admit exactly once', async () => {
    const event = await createEvent();
    const { token } = await guestWithQr(event.id);
    const results = await Promise.all(
      Array.from({ length: 20 }, () => scan(event.id, token).expect(200)),
    );
    const outcomes = results.map((r) => r.body.data.result as string);
    expect(outcomes.filter((r) => r === 'ADMITTED')).toHaveLength(1);
    expect(outcomes.filter((r) => r === 'ALREADY_ADMITTED')).toHaveLength(19);
  });

  it('reports invalid, revoked, declined and other-event codes without admitting', async () => {
    const event = await createEvent();
    const declined = await guestWithQr(event.id, GuestRsvp.DECLINED);
    const elsewhere = await createEvent({ ownerId: otherId });
    const foreign = await guestWithQr(elsewhere.id);
    const revoked = await guestWithQr(event.id);
    await db
      .getRepository(Guest)
      .update(revoked.guest.id, { qrTokenHash: null });

    const result = async (token: string): Promise<unknown> =>
      (await scan(event.id, token).expect(200)).body.data as unknown;
    expect(await result('not a code')).toMatchObject({ result: 'INVALID' });
    expect(await result(newQrToken())).toMatchObject({ result: 'INVALID' });
    expect(await result(revoked.token)).toMatchObject({ result: 'INVALID' }); // TC-QR-04
    expect(await result(declined.token)).toMatchObject({
      result: 'NOT_ACCEPTED',
    });
    const wrong = await result(foreign.token);
    expect(wrong).toEqual({ result: 'WRONG_EVENT', admittedCount: 0 });
    const admitted = await db.query<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM guests WHERE checked_in_at IS NOT NULL',
    );
    expect(admitted[0].n).toBe(0);
  });

  it('AC-07-4: refuses scans outside the admission window or for a cancelled event', async () => {
    const early = await createEvent({
      startsAt: new Date(Date.now() + 5 * HOUR_MS),
      admissionOpensAt: new Date(Date.now() + 4 * HOUR_MS),
      admissionClosesAt: new Date(Date.now() + 6 * HOUR_MS),
    });
    const cancelled = await createEvent({ status: EventStatus.CANCELLED });
    for (const event of [early, cancelled]) {
      const { guest, token } = await guestWithQr(event.id);
      const res = await scan(event.id, token).expect(200);
      expect(res.body.data.result).toBe('WINDOW_CLOSED');
      const stored = await db
        .getRepository(Guest)
        .findOneByOrFail({ id: guest.id });
      expect(stored.checkedInAt).toBeNull();
    }
  });

  it('AC-07-2 / TC-QR-05: only the signed-in owner of the event can scan', async () => {
    const event = await createEvent();
    const { token } = await guestWithQr(event.id);
    await scan(event.id, token, adminAccess).expect(403);
    await scan(event.id, token, otherAccess).expect(404);
    await csrf(server().post(`/api/scan/events/${event.id}/check-ins`))
      .send({ token })
      .expect(401);
    await bearer(otherAccess)(
      server().get(`/api/scan/events/${event.id}/stats`),
    ).expect(404);
    const stored = await db.query<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM guests WHERE checked_in_at IS NOT NULL',
    );
    expect(stored[0].n).toBe(0);
  });

  it('SCR-40: the guest page shows the QR, never checks in, then shows admitted', async () => {
    const event = await createEvent();
    const { token } = await guestWithQr(event.id);
    const page = await server()
      .get(`/api/public/invitations/${token}`)
      .expect(200);
    expect(page.headers['cache-control']).toBe('no-store');
    expect(page.body.data).toMatchObject({
      guestName: 'محمد العتيبي',
      eventName: 'زفاف نورة',
      venueName: 'قاعة الضيافة',
      venueMapUrl: 'https://maps.example.com/q',
      status: 'VALID',
      checkedInAt: null,
    });
    expect(page.body.data.qrSvg).toContain('<svg');
    expect((await scan(event.id, token).expect(200)).body.data.result).toBe(
      'ADMITTED',
    );
    const after = await server()
      .get(`/api/public/invitations/${token}`)
      .expect(200);
    expect(after.body.data.status).toBe('ADMITTED');
  });

  it('SCR-40: unknown, revoked and declined codes are 404; a closed event hides the QR', async () => {
    await server().get(`/api/public/invitations/${newQrToken()}`).expect(404);
    await server().get('/api/public/invitations/short').expect(404);
    const event = await createEvent();
    const declined = await guestWithQr(event.id, GuestRsvp.DECLINED);
    await server().get(`/api/public/invitations/${declined.token}`).expect(404);

    const closed = await createEvent({ status: EventStatus.CLOSED });
    const { token } = await guestWithQr(closed.id);
    const res = await server()
      .get(`/api/public/invitations/${token}`)
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'CLOSED', qrSvg: null });
  });
});
