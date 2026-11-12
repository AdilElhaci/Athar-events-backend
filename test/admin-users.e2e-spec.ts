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
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { User, UserStatus } from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';

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

describe('Admin users: suspend and reactivate (e2e, T-P4-07)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let db: DataSource;
  let redis: Redis;
  const access: Record<string, string> = {};
  const refresh: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const setStatus = (id: string, body: object, who = 'admin') =>
    csrf(
      server()
        .patch(`/api/admin/users/${id}/status`)
        .set('Authorization', `Bearer ${access[who]}`),
    ).send(body);
  const me = (who: string) =>
    server().get('/api/auth/me').set('Authorization', `Bearer ${access[who]}`);
  const refreshCookie = (res: request.Response) =>
    ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .map((c) => /^athar_events_rt=([^;]+)/.exec(c)?.[1])
      .find(Boolean)!;
  const login = async (who: string, email: string) => {
    const res = await csrf(server().post('/api/auth/login'))
      .send({ email, password: PASSWORD })
      .expect(200);
    access[who] = (
      res.body as { data: { accessToken: string } }
    ).data.accessToken;
    refresh[who] = refreshCookie(res);
  };
  const userOf = (id: string) => db.getRepository(User).findOneByOrFail({ id });

  async function provisionAdmin(email: string, accept: boolean) {
    const before = mail.sent.length;
    await app
      .get(AdminProvisioningService)
      .provision(email, 'المدير', { promote: false });
    ids[email] = (await db.getRepository(User).findOneByOrFail({ email })).id;
    if (!accept) return;
    const invite = mail.sent
      .slice(before)
      .map((m) => /#token=([\w-]+)/.exec(m.message.text)?.[1])
      .find(Boolean);
    await csrf(server().post('/api/auth/accept-invite'))
      .send({ token: invite, password: PASSWORD })
      .expect(200);
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

    await provisionAdmin('admin@example.com', true);
    ids.admin = ids['admin@example.com'];
    await login('admin', 'admin@example.com');

    await csrf(server().post('/api/auth/register/start'))
      .send({ email: 'owner@example.com', name: 'سارة العتيبي' })
      .expect(200);
    const code = /(\d{6})/.exec(mail.sent.at(-1)!.message.text)![1];
    const verify = await csrf(server().post('/api/auth/register/verify'))
      .send({ email: 'owner@example.com', code })
      .expect(200);
    await csrf(server().post('/api/auth/register/complete'))
      .send({
        registrationToken: (
          verify.body as { data: { registrationToken: string } }
        ).data.registrationToken,
        password: PASSWORD,
      })
      .expect(200);
    ids.owner = (
      await db
        .getRepository(User)
        .findOneByOrFail({ email: 'owner@example.com' })
    ).id;
  });

  beforeEach(() => redis.flushdb());

  afterAll(async () => {
    await app.close();
  });

  it('suspends an owner: open sessions end at once and sign-in is refused (TC-ADM-05)', async () => {
    await login('owner', 'owner@example.com');
    await me('owner').expect(200);

    await setStatus(ids.owner, { status: 'SUSPENDED', reason: 'x' }).expect(
      400,
    );
    await setStatus(ids.owner, { status: 'INVITED', reason: 'مخالفة' }).expect(
      400,
    );
    const res = await setStatus(ids.owner, {
      status: 'SUSPENDED',
      reason: 'بلاغ احتيال',
    }).expect(200);
    expect(res.body.code).toBe('users.suspended');
    expect(res.body.data).toMatchObject({ id: ids.owner, status: 'SUSPENDED' });
    expect(res.body.data).not.toHaveProperty('passwordHash');

    await me('owner').expect(401);
    await csrf(server().post('/api/auth/refresh'))
      .set('Cookie', `athar_events_rt=${refresh.owner}`)
      .expect(401);
    await csrf(server().post('/api/auth/login'))
      .send({ email: 'owner@example.com', password: PASSWORD })
      .expect(401);
    const again = await setStatus(ids.owner, {
      status: 'SUSPENDED',
      reason: 'مرة أخرى',
    }).expect(409);
    expect(again.body.code).toBe('users.already_suspended');

    const audit = await db
      .getRepository(AdminAction)
      .findOneByOrFail({ action: 'user.suspended', targetId: ids.owner });
    expect(audit).toMatchObject({
      actorUserId: ids.admin,
      targetType: 'user',
      summary: { userType: 'OWNER', reason: 'بلاغ احتيال' },
    });
  });

  it('reactivates a suspended owner, who can sign in again', async () => {
    const res = await setStatus(ids.owner, {
      status: 'ACTIVE',
      reason: 'انتهت المراجعة',
    }).expect(200);
    expect(res.body.code).toBe('users.reactivated');
    expect((await userOf(ids.owner)).status).toBe(UserStatus.ACTIVE);
    await login('owner', 'owner@example.com');
    await me('owner').expect(200);
    const again = await setStatus(ids.owner, {
      status: 'ACTIVE',
      reason: 'مرة أخرى',
    }).expect(409);
    expect(again.body.code).toBe('users.already_active');
    await db
      .getRepository(AdminAction)
      .findOneByOrFail({ action: 'user.reactivated', targetId: ids.owner });
  });

  it('refuses yourself, invited admins, unknown users and non-admins', async () => {
    const self = await setStatus(ids.admin, {
      status: 'SUSPENDED',
      reason: 'تجربة',
    }).expect(409);
    expect(self.body.code).toBe('users.self');
    expect((await userOf(ids.admin)).status).toBe(UserStatus.ACTIVE);

    await provisionAdmin('pending@example.com', false);
    const invited = await setStatus(ids['pending@example.com'], {
      status: 'SUSPENDED',
      reason: 'لم يفعّل',
    }).expect(409);
    expect(invited.body.code).toBe('users.invited');

    await setStatus('00000000-0000-4000-8000-000000000000', {
      status: 'SUSPENDED',
      reason: 'غير موجود',
    }).expect(404);
    await setStatus(
      ids.admin,
      { status: 'SUSPENDED', reason: 'من صاحب مناسبة' },
      'owner',
    ).expect(403);
    await server()
      .patch(`/api/admin/users/${ids.owner}/status`)
      .set('Authorization', `Bearer ${access.admin}`)
      .send({ status: 'SUSPENDED', reason: 'بدون CSRF' })
      .expect(403);
  });

  it('lets one admin suspend another, ending that admin’s access', async () => {
    await provisionAdmin('second@example.com', true);
    await login('second', 'second@example.com');
    await me('second').expect(200);
    await setStatus(ids['second@example.com'], {
      status: 'SUSPENDED',
      reason: 'ترك الفريق',
    }).expect(200);
    await me('second').expect(401);
  });
});
