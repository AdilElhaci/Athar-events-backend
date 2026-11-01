import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';

const ORIGIN = 'http://localhost:3000';
const STRONG = 'قصر الضيافة 2026 مساءً';

/** Captures outgoing email instead of using SMTP. */
class CapturingMail {
  sent: Array<{ to: string; message: MailMessage }> = [];
  sendLater(to: string, message: MailMessage) {
    this.sent.push({ to, message });
  }
  send(to: string, message: MailMessage) {
    this.sent.push({ to, message });
    return Promise.resolve();
  }
  last(to: string, kind: MailMessage['kind']) {
    return [...this.sent]
      .reverse()
      .find((m) => m.to === to && m.message.kind === kind)?.message;
  }
  code(to: string) {
    return /(\d{6})/.exec(this.last(to, 'register_code')?.text ?? '')?.[1];
  }
  token(to: string, kind: MailMessage['kind']) {
    return /#token=([\w-]+)/.exec(this.last(to, kind)?.text ?? '')?.[1];
  }
}

describe('Authentication and admin (e2e)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let db: DataSource;
  let redis: Redis;

  const post = (path: string) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Origin', ORIGIN)
      .set('X-Requested-With', 'athar-events');

  const cookieValue = (res: request.Response, name: string) => {
    const raw = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const line = raw.find((c) => c.startsWith(`${name}=`));
    return line ? { line, value: line.split(';')[0].split('=')[1] } : undefined;
  };

  async function register(email: string, name = 'سارة', password = STRONG) {
    await post('/auth/register/start').send({ email, name }).expect(200);
    const code = mail.code(email);
    const verify = await post('/auth/register/verify')
      .send({ email, code })
      .expect(200);
    return post('/auth/register/complete').send({
      registrationToken: verify.body.data.registrationToken,
      password,
    });
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
  });

  beforeEach(async () => {
    await redis.flushdb(); // fresh rate-limit counters per test
  });

  afterAll(async () => {
    await app.close();
  });

  describe('registration', () => {
    it('registers in three steps, sets an HttpOnly refresh cookie and signs in', async () => {
      const weak = await register('owner1@example.com', 'سارة', 'short');
      expect(weak.status).toBe(400);
      expect(weak.body.code).toBe('password.too_short');

      const res = await register('owner2@example.com');
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      const rt = cookieValue(res, 'athar_events_rt');
      expect(rt?.line).toMatch(/HttpOnly/);
      expect(rt?.line).toMatch(/Path=\/api\/auth/);
      expect(rt?.line).toMatch(/Secure/);
      expect(rt?.line).not.toMatch(/Domain=/);

      const me = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`)
        .expect(200);
      expect(me.body.data).toMatchObject({
        email: 'owner2@example.com',
        type: 'OWNER',
        status: 'ACTIVE',
      });
      expect(me.body.data.passwordHash).toBeUndefined();
    });

    it('answers identically for new and existing emails (no enumeration)', async () => {
      await register('known@example.com');
      await redis.flushdb();
      const existing = await post('/auth/register/start').send({
        email: 'known@example.com',
        name: 'x y',
      });
      const fresh = await post('/auth/register/start').send({
        email: 'brand-new@example.com',
        name: 'x y',
      });
      expect(existing.status).toBe(fresh.status);
      expect(existing.body).toEqual(fresh.body);
      expect(mail.last('known@example.com', 'account_exists')).toBeDefined();
    });

    it('never lets public registration create an administrator', async () => {
      const res = await post('/auth/register/start').send({
        email: 'evil@example.com',
        name: 'evil',
        type: 'PLATFORM_ADMIN',
      });
      expect(res.status).toBe(400);
    });

    it('locks a code after 5 wrong attempts, even if the right code comes next', async () => {
      await post('/auth/register/start')
        .send({ email: 'guess@example.com', name: 'guess' })
        .expect(200);
      const right = mail.code('guess@example.com');
      const wrong = right === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await post('/auth/register/verify')
          .send({ email: 'guess@example.com', code: wrong })
          .expect(400);
      }
      await post('/auth/register/verify')
        .send({ email: 'guess@example.com', code: right })
        .expect(400);
    });

    it('accepts Arabic-Indic digits in the code', async () => {
      await post('/auth/register/start')
        .send({ email: 'arabic@example.com', name: 'نورة' })
        .expect(200);
      const code = mail.code('arabic@example.com')!;
      const arabic = code.replace(/\d/g, (d) =>
        String.fromCharCode(0x0660 + Number(d)),
      );
      await post('/auth/register/verify')
        .send({ email: 'arabic@example.com', code: arabic })
        .expect(200);
    });

    it('refuses a registration token twice', async () => {
      await post('/auth/register/start')
        .send({ email: 'twice@example.com', name: 'twice' })
        .expect(200);
      const verify = await post('/auth/register/verify')
        .send({
          email: 'twice@example.com',
          code: mail.code('twice@example.com'),
        })
        .expect(200);
      const token = verify.body.data.registrationToken;
      await post('/auth/register/complete')
        .send({ registrationToken: token, password: STRONG })
        .expect(200);
      const again = await post('/auth/register/complete').send({
        registrationToken: token,
        password: STRONG,
      });
      expect(again.status).toBe(400);
    });
  });

  describe('login, CSRF and sessions', () => {
    beforeAll(async () => {
      await register('login@example.com');
    });

    it('returns the same error for a wrong password and an unknown email', async () => {
      const wrong = await post('/auth/login').send({
        email: 'login@example.com',
        password: 'not the right password',
      });
      const unknown = await post('/auth/login').send({
        email: 'nobody@example.com',
        password: 'not the right password',
      });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('rejects cookie endpoints without the exact Origin and custom header', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'login@example.com', password: STRONG })
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', 'http://evil.example')
        .set('X-Requested-With', 'athar-events')
        .send({ email: 'login@example.com', password: STRONG })
        .expect(403);
    });

    it('rotates refresh tokens and ends the session when an old token is replayed', async () => {
      const login = await post('/auth/login')
        .send({ email: 'login@example.com', password: STRONG })
        .expect(200);
      const first = cookieValue(login, 'athar_events_rt')!.value;

      const rotated = await post('/auth/refresh')
        .set('Cookie', `athar_events_rt=${first}`)
        .expect(200);
      const second = cookieValue(rotated, 'athar_events_rt')!.value;
      expect(second).not.toBe(first);

      // Replay of the old token after the grace window: theft signal → session revoked.
      await db.query(
        `UPDATE refresh_tokens SET rotated_at = now() - interval '1 minute' WHERE rotated_at IS NOT NULL`,
      );
      await post('/auth/refresh')
        .set('Cookie', `athar_events_rt=${first}`)
        .expect(401);
      await post('/auth/refresh')
        .set('Cookie', `athar_events_rt=${second}`)
        .expect(401);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${rotated.body.data.accessToken}`)
        .expect(401);
    });

    it('logout invalidates the access token immediately', async () => {
      const login = await post('/auth/login')
        .send({ email: 'login@example.com', password: STRONG })
        .expect(200);
      const access = login.body.data.accessToken;
      const rt = cookieValue(login, 'athar_events_rt')!.value;
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${access}`)
        .expect(200);
      await post('/auth/logout')
        .set('Cookie', `athar_events_rt=${rt}`)
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${access}`)
        .expect(401);
    });

    it('limits repeated failed logins per IP and email', async () => {
      let last = 0;
      for (let i = 0; i < 11; i++) {
        last = (
          await post('/auth/login').send({
            email: 'login@example.com',
            password: 'wrong password!!',
          })
        ).status;
      }
      expect(last).toBe(429);
    });
  });

  describe('profile and change password', () => {
    const patch = (path: string, access: string) =>
      request(app.getHttpServer())
        .patch(`/api${path}`)
        .set('Origin', ORIGIN)
        .set('X-Requested-With', 'athar-events')
        .set('Authorization', `Bearer ${access}`);

    it('updates the name and a normalised Saudi mobile, and clears the phone', async () => {
      const access = (await register('profile@example.com')).body.data
        .accessToken as string;

      const updated = await patch('/auth/me', access)
        .send({ name: 'سارة العتيبي', phone: '٠٥٠ ١٢٣ ٤٥٦٧' })
        .expect(200);
      expect(updated.body.code).toBe('auth.profile_updated');
      expect(updated.body.data).toMatchObject({
        name: 'سارة العتيبي',
        phone: '966501234567',
      });

      const bad = await patch('/auth/me', access)
        .send({ phone: '0112345678' })
        .expect(400);
      expect(bad.body.code).toBe('user.phone_invalid');

      const cleared = await patch('/auth/me', access)
        .send({ phone: '' })
        .expect(200);
      expect(cleared.body.data.phone).toBeNull();
      expect(cleared.body.data.name).toBe('سارة العتيبي');

      await request(app.getHttpServer())
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${access}`)
        .send({ name: 'بدون رأس الحماية' })
        .expect(403);
    });

    it('changes the password only with the current one and ends every session', async () => {
      const access = (await register('changer@example.com')).body.data
        .accessToken as string;
      const change = (body: object) =>
        post('/auth/change-password')
          .set('Authorization', `Bearer ${access}`)
          .send(body);

      const wrong = await change({
        currentPassword: 'not my password',
        newPassword: 'new-pass-8',
      }).expect(400);
      expect(wrong.body.code).toBe('auth.current_password_invalid');

      const short = await change({
        currentPassword: STRONG,
        newPassword: 'seven77',
      }).expect(400);
      expect(short.body.code).toBe('password.too_short');

      const ok = await change({
        currentPassword: STRONG,
        newPassword: 'new-pass-8',
      }).expect(200);
      expect(ok.body.code).toBe('auth.password_changed');
      expect(
        mail.last('changer@example.com', 'password_changed'),
      ).toBeDefined();

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${access}`)
        .expect(401);
      await post('/auth/login')
        .send({ email: 'changer@example.com', password: STRONG })
        .expect(401);
      await post('/auth/login')
        .send({ email: 'changer@example.com', password: 'new-pass-8' })
        .expect(200);
    });
  });

  describe('contact form', () => {
    const message = {
      name: 'نورة',
      phone: '0501234567',
      subject: 'أرغب بمعرفة تفاصيل باقة فرحة لحفل في ديسمبر.',
    };

    it('e-mails a valid message to the team inbox, escaping its content', async () => {
      const before = mail.sent.length;
      const res = await post('/contact')
        .send({ ...message, name: '<b>نورة</b>' })
        .expect(200);
      expect(res.body.code).toBe('contact.sent');
      const sent = mail.sent.slice(before);
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('no-reply@example.com'); // MAIL_FROM fallback
      expect(sent[0].message.kind).toBe('contact_message');
      expect(sent[0].message.text).toContain('+966501234567');
      expect(sent[0].message.html).toContain('&lt;b&gt;');
      expect(sent[0].message.html).not.toContain('<b>نورة');
    });

    it('rejects an invalid phone, short subjects and missing CSRF headers', async () => {
      const phone = await post('/contact')
        .send({ ...message, phone: '12345' })
        .expect(400);
      expect(phone.body.code).toBe('user.phone_invalid');
      await post('/contact')
        .send({ ...message, subject: 'قصير' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/api/contact')
        .send(message)
        .expect(403);
    });

    it('silently drops honeypot submissions and limits messages per IP', async () => {
      const before = mail.sent.length;
      await post('/contact')
        .send({ ...message, website: 'http://spam.example' })
        .expect(200);
      expect(mail.sent.length).toBe(before);

      let last = 0;
      for (let i = 0; i < 6; i++)
        last = (await post('/contact').send(message)).status;
      expect(last).toBe(429);
    });
  });

  describe('forgot and reset password', () => {
    it('resets the password, ends every session and keeps the response generic', async () => {
      const reg = await register('reset@example.com');
      const oldAccess = reg.body.data.accessToken;
      const oldRt = cookieValue(reg, 'athar_events_rt')!.value;
      await redis.flushdb(); // the registration code email started the 60 s per-address cooldown

      const unknown = await post('/auth/forgot-password').send({
        email: 'ghost@example.com',
      });
      const known = await post('/auth/forgot-password').send({
        email: 'reset@example.com',
      });
      expect(unknown.body).toEqual(known.body);
      expect(mail.last('ghost@example.com', 'password_reset')).toBeUndefined();

      const token = mail.token('reset@example.com', 'password_reset')!;
      expect(mail.last('reset@example.com', 'password_reset')!.text).toContain(
        '/auth/reset-password#token=',
      );
      const NEW = 'كلمة مرور جديدة طويلة 99';
      await post('/auth/reset-password')
        .send({ token, password: NEW })
        .expect(200);
      await post('/auth/reset-password')
        .send({ token, password: NEW })
        .expect(400); // single use

      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${oldAccess}`)
        .expect(401);
      await post('/auth/refresh')
        .set('Cookie', `athar_events_rt=${oldRt}`)
        .expect(401);
      await post('/auth/login')
        .send({ email: 'reset@example.com', password: STRONG })
        .expect(401);
      await post('/auth/login')
        .send({ email: 'reset@example.com', password: NEW })
        .expect(200);
      expect(mail.last('reset@example.com', 'password_changed')).toBeDefined();
    });

    it('only the newest reset link works', async () => {
      await register('twolinks@example.com');
      await post('/auth/forgot-password')
        .send({ email: 'twolinks@example.com' })
        .expect(200);
      const first = mail.token('twolinks@example.com', 'password_reset')!;
      await redis.flushdb(); // skip the 60 s email cooldown
      await post('/auth/forgot-password')
        .send({ email: 'twolinks@example.com' })
        .expect(200);
      const second = mail.token('twolinks@example.com', 'password_reset')!;
      expect(second).not.toBe(first);
      await post('/auth/reset-password')
        .send({ token: first, password: 'another long password 1' })
        .expect(400);
      await post('/auth/reset-password')
        .send({ token: second, password: 'another long password 1' })
        .expect(200);
    });
  });

  describe('security review fixes', () => {
    it('a near-simultaneous second refresh gets 409 and keeps the winning cookie', async () => {
      const reg = await register('race@example.com');
      const token = cookieValue(reg, 'athar_events_rt')!.value;
      const [a, b] = await Promise.all([
        post('/auth/refresh').set('Cookie', `athar_events_rt=${token}`),
        post('/auth/refresh').set('Cookie', `athar_events_rt=${token}`),
      ]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([200, 409]);
      const loser = a.status === 409 ? a : b;
      const winner = a.status === 200 ? a : b;
      expect(loser.body.code).toBe('auth.refresh_race');
      expect(cookieValue(loser, 'athar_events_rt')).toBeUndefined(); // cookies untouched
      const next = cookieValue(winner, 'athar_events_rt')!.value;
      await post('/auth/refresh')
        .set('Cookie', `athar_events_rt=${next}`)
        .expect(200);
    });

    it('repairs a rate-limit counter that lost its TTL', async () => {
      const key = `rl:login:email:${createHash('sha256').update('ttl@example.com').digest('hex')}`;
      await redis.set(key, '3'); // no expiry
      await post('/auth/login').send({
        email: 'ttl@example.com',
        password: 'whatever password',
      });
      expect(await redis.ttl(key)).toBeGreaterThan(0);
    });

    it('answers malformed JSON with a generic 400 that never echoes the body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('Origin', ORIGIN)
        .set('X-Requested-With', 'athar-events')
        .set('Content-Type', 'application/json')
        .send('{"email":"a@b.co","password":"secret-value"');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('common.bad_request');
      expect(JSON.stringify(res.body)).not.toContain('secret-value');
    });

    it('upgrades an old password hash on login', async () => {
      await register('rehash@example.com');
      const weak = await argon2.hash(STRONG.normalize('NFKC'), {
        type: argon2.argon2id,
        memoryCost: 4096,
        timeCost: 1,
        parallelism: 1,
      });
      await db.query(`UPDATE users SET password_hash = $1 WHERE email = $2`, [
        weak,
        'rehash@example.com',
      ]);
      await post('/auth/login')
        .send({ email: 'rehash@example.com', password: STRONG })
        .expect(200);
      const [row] = await db.query(
        `SELECT password_hash FROM users WHERE email = $1`,
        ['rehash@example.com'],
      );
      expect(row.password_hash).not.toBe(weak);
      expect(row.password_hash).toContain('m=19456');
    });
  });

  describe('admin provisioning and users list', () => {
    let adminAccess: string;
    let ownerAccess: string;

    beforeAll(async () => {
      const provisioning = app.get(AdminProvisioningService);
      expect(
        await provisioning.provision('Admin@Example.com', 'المدير', {
          promote: false,
        }),
      ).toBe('invited');
      const invite = mail.token('admin@example.com', 'admin_invite')!;

      // An invited admin cannot sign in before choosing a password.
      await redis.flushdb();
      await post('/auth/login')
        .send({ email: 'admin@example.com', password: STRONG })
        .expect(401);

      // A reset token is never accepted as an invite and vice versa (purpose-bound).
      await post('/auth/reset-password')
        .send({ token: invite, password: STRONG })
        .expect(400);
      await post('/auth/accept-invite')
        .send({ token: invite, password: STRONG })
        .expect(200);
      const login = await post('/auth/login')
        .send({ email: 'admin@example.com', password: STRONG })
        .expect(200);
      adminAccess = login.body.data.accessToken;

      const owner = await register(
        'plain-owner@example.com',
        'مالك 100%_مناسبة',
      );
      ownerAccess = owner.body.data.accessToken;
    });

    const list = (token: string | null, query = '') => {
      const req = request(app.getHttpServer()).get(`/api/admin/users${query}`);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    it('lists users with pagination for admins only', async () => {
      await list(null).expect(401);
      await list(ownerAccess).expect(403);
      const res = await list(adminAccess, '?page=1&limit=2').expect(200);
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.meta).toMatchObject({
        page: 1,
        limit: 2,
        hasPrev: false,
      });
      expect(res.body.data.meta.total).toBeGreaterThan(2);
      expect(JSON.stringify(res.body)).not.toMatch(/password|sessionVersion/i);
      await list(adminAccess, '?limit=1000').expect(400);
    });

    it('searches by name or email and treats wildcards literally', async () => {
      const byEmail = await list(adminAccess, '?search=PLAIN-OWNER').expect(
        200,
      );
      expect(
        byEmail.body.data.items.map((u: { email: string }) => u.email),
      ).toEqual(['plain-owner@example.com']);
      const wildcard = await list(
        adminAccess,
        `?search=${encodeURIComponent('100%_')}`,
      ).expect(200);
      expect(wildcard.body.data.items).toHaveLength(1);
      const onlyPercent = await list(
        adminAccess,
        `?search=${encodeURIComponent('%')}`,
      ).expect(200);
      expect(onlyPercent.body.data.items).toHaveLength(1);
      const admins = await list(adminAccess, '?type=PLATFORM_ADMIN').expect(
        200,
      );
      expect(
        admins.body.data.items.every(
          (u: { type: string }) => u.type === 'PLATFORM_ADMIN',
        ),
      ).toBe(true);
    });

    describe('packages', () => {
      const FARHA = {
        name: 'فرحة',
        description: 'لمناسبتك التي تجمع الأحبة',
        invitationAllowance: 250,
        extraMargin: 25,
        priceHalalas: 99000,
      };
      const publicList = () =>
        request(app.getHttpServer()).get('/api/packages').expect(200);
      const adminPost = (token: string) =>
        post('/admin/packages').set('Authorization', `Bearer ${token}`);
      const adminPatch = (token: string, id: string) =>
        request(app.getHttpServer())
          .patch(`/api/admin/packages/${id}`)
          .set('Origin', ORIGIN)
          .set('X-Requested-With', 'athar-events')
          .set('Authorization', `Bearer ${token}`);

      it('lets only admins manage packages', async () => {
        await post('/admin/packages').send(FARHA).expect(401);
        await adminPost(ownerAccess).send(FARHA).expect(403);
        await request(app.getHttpServer())
          .post('/api/admin/packages')
          .set('Authorization', `Bearer ${adminAccess}`)
          .send(FARHA)
          .expect(403); // no CSRF header
        await request(app.getHttpServer())
          .get('/api/admin/packages')
          .set('Authorization', `Bearer ${ownerAccess}`)
          .expect(403);
      });

      it('lists only active packages publicly, in display order', async () => {
        const hidden = await adminPost(adminAccess).send(FARHA).expect(201);
        expect(hidden.body.data).toMatchObject({
          isActive: false,
          currency: 'SAR',
        });
        expect((await publicList()).body.data).toEqual([]);

        const second = await adminPost(adminAccess)
          .send({ ...FARHA, name: 'أثر', isActive: true, sortOrder: 2 })
          .expect(201);
        const first = await adminPost(adminAccess)
          .send({ ...FARHA, name: 'لمة', isActive: true, sortOrder: 1 })
          .expect(201);
        const listed = (await publicList()).body.data;
        expect(listed.map((p: { id: string }) => p.id)).toEqual([
          first.body.data.id,
          second.body.data.id,
        ]);
        expect(listed[0]).not.toHaveProperty('isActive');

        const secondId: string = second.body.data.id;
        await adminPatch(adminAccess, secondId)
          .send({ isActive: false, priceHalalas: 120000 })
          .expect(200);
        expect((await publicList()).body.data).toHaveLength(1);

        const all = await request(app.getHttpServer())
          .get('/api/admin/packages?limit=100')
          .set('Authorization', `Bearer ${adminAccess}`)
          .expect(200);
        expect(all.body.data.meta.total).toBe(3);

        const log = await db.query(
          `SELECT "action", "summary" FROM "admin_actions" WHERE "target_id" = $1 ORDER BY "created_at"`,
          [secondId],
        );
        expect(log.map((r: { action: string }) => r.action)).toEqual([
          'package.created',
          'package.updated',
        ]);
        expect(log[1].summary.fields.sort()).toEqual([
          'isActive',
          'priceHalalas',
        ]);
      });

      it('rejects invalid package fields', async () => {
        const invalid = [
          { ...FARHA, invitationAllowance: 0 },
          { ...FARHA, extraMargin: -1 },
          { ...FARHA, priceHalalas: 0 },
          { ...FARHA, priceHalalas: 2_147_483_648 },
          { ...FARHA, priceHalalas: 99.5 },
          { ...FARHA, name: ' ' },
          { ...FARHA, currency: 'USD' },
        ];
        for (const body of invalid)
          await adminPost(adminAccess).send(body).expect(400);

        const created = await adminPost(adminAccess).send(FARHA).expect(201);
        const id: string = created.body.data.id;
        await adminPatch(adminAccess, id).send({ name: null }).expect(400);
        await adminPatch(adminAccess, id)
          .send({ priceHalalas: null })
          .expect(400);
        const cleared = await adminPatch(adminAccess, id)
          .send({ description: '  ' })
          .expect(200);
        expect(cleared.body.data.description).toBeNull();
        await adminPatch(adminAccess, '00000000-0000-4000-8000-000000000000')
          .send({ name: 'أثر' })
          .expect(404);
      });
    });

    describe('events', () => {
      const HOUR = 3_600_000;
      const inHours = (hours: number) =>
        new Date(Date.now() + hours * HOUR).toISOString();
      const MISSING = '00000000-0000-4000-8000-000000000000';
      let packageId: string;
      let otherOwnerAccess: string;

      const send = (
        method: 'post' | 'patch' | 'get',
        path: string,
        token: string,
      ) =>
        request(app.getHttpServer())
          [method](`/api${path}`)
          .set('Origin', ORIGIN)
          .set('X-Requested-With', 'athar-events')
          .set('Authorization', `Bearer ${token}`);
      const eventBody = (overrides: object = {}) => ({
        packageId,
        name: 'زفاف نورة',
        startsAt: inHours(240),
        venueName: 'قاعة النخيل',
        ...overrides,
      });
      const createPackage = async (overrides: object = {}) => {
        const res = await send('post', '/admin/packages', adminAccess)
          .send({
            name: 'لمّة',
            invitationAllowance: 100,
            extraMargin: 10,
            priceHalalas: 49000,
            isActive: true,
            ...overrides,
          })
          .expect(201);
        return res.body.data.id as string;
      };

      beforeAll(async () => {
        packageId = await createPackage();
        const other = await register('other-owner@example.com');
        otherOwnerAccess = other.body.data.accessToken;
      });

      it('creates an unpaid event with a package snapshot and defaults', async () => {
        const startsAt = inHours(240);
        const res = await send('post', '/events', ownerAccess)
          .send(
            eventBody({
              startsAt,
              venueMapUrl: 'https://maps.example.com/venue',
              requestedSendAt: inHours(100),
            }),
          )
          .expect(201);
        const event = res.body.data;
        expect(res.body.code).toBe('event.created');
        expect(event.referenceCode).toMatch(/^AE-\d{6}$/);
        expect(event).toMatchObject({
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          listStatus: 'AWAITING_LIST',
          approvalStatus: 'NOT_REQUESTED',
          campaignStatus: 'NOT_SCHEDULED',
          nextAction: 'COMPLETE_PAYMENT',
          editable: true,
          packageEditable: true,
          package: {
            id: packageId,
            name: 'لمّة',
            invitationAllowance: 100,
            extraMargin: 10,
            priceHalalas: 49000,
            currency: 'SAR',
          },
        });
        const start = new Date(startsAt).getTime();
        expect(new Date(event.admissionOpensAt as string).getTime()).toBe(
          start - 3 * HOUR,
        );
        expect(new Date(event.admissionClosesAt as string).getTime()).toBe(
          start + 12 * HOUR,
        );
      });

      it('gives each event its own reference', async () => {
        const first = await send('post', '/events', ownerAccess)
          .send(eventBody())
          .expect(201);
        const second = await send('post', '/events', ownerAccess)
          .send(eventBody())
          .expect(201);
        expect(first.body.data.referenceCode).not.toBe(
          second.body.data.referenceCode,
        );
      });

      it('keeps events private to their owner', async () => {
        const res = await send('post', '/events', ownerAccess)
          .send(eventBody({ name: 'مناسبة خاصة جداً' }))
          .expect(201);
        const id: string = res.body.data.id;

        await request(app.getHttpServer()).get(`/api/events/${id}`).expect(401);
        await send('get', `/events/${id}`, otherOwnerAccess).expect(404);
        await send('patch', `/events/${id}`, otherOwnerAccess)
          .send({ name: 'تغيير' })
          .expect(404);
        await send('get', `/events/${id}`, adminAccess).expect(403);
        await send('post', '/events', adminAccess)
          .send(eventBody())
          .expect(403);

        const others = await send(
          'get',
          '/events?search=' + encodeURIComponent('خاصة'),
          otherOwnerAccess,
        ).expect(200);
        expect(others.body.data.items).toEqual([]);
        const mine = await send(
          'get',
          '/events?search=' + encodeURIComponent('خاصة'),
          ownerAccess,
        ).expect(200);
        expect(mine.body.data.items.map((e: { id: string }) => e.id)).toEqual([
          id,
        ]);
        await send('get', `/events/${id}`, ownerAccess).expect(200);
      });

      it('refuses cross-site writes', async () => {
        await request(app.getHttpServer())
          .post('/api/events')
          .set('Authorization', `Bearer ${ownerAccess}`)
          .send(eventBody())
          .expect(403);
      });

      it('rejects inactive packages and impossible times', async () => {
        const inactive = await createPackage({ isActive: false });
        const cases: Array<[object, string]> = [
          [{ packageId: inactive }, 'events.package_inactive'],
          [{ packageId: MISSING }, 'events.package_inactive'],
          [{ startsAt: inHours(-1) }, 'events.starts_in_past'],
          [{ requestedSendAt: inHours(241) }, 'events.send_after_start'],
          [{ requestedSendAt: inHours(-1) }, 'events.send_in_past'],
        ];
        for (const [body, code] of cases) {
          const res = await send('post', '/events', ownerAccess)
            .send(eventBody(body))
            .expect(422);
          expect(res.body.code).toBe(code);
        }
        const invalid = [
          { name: ' ' },
          { startsAt: 'غداً' },
          { venueName: '' },
          { venueMapUrl: 'http://maps.example.com' },
          { venueMapUrl: 'javascript:alert(1)' },
          { priceHalalas: 1 },
        ];
        for (const body of invalid)
          await send('post', '/events', ownerAccess)
            .send(eventBody(body))
            .expect(400);
      });

      it('freezes the snapshot against catalogue edits and allows owner edits', async () => {
        const created = await send('post', '/events', ownerAccess)
          .send(eventBody())
          .expect(201);
        const id: string = created.body.data.id;

        await send('patch', `/admin/packages/${packageId}`, adminAccess)
          .send({ priceHalalas: 99900 })
          .expect(200);
        const reread = await send('get', `/events/${id}`, ownerAccess).expect(
          200,
        );
        expect(reread.body.data.package.priceHalalas).toBe(49000);

        const startsAt = inHours(300);
        const larger = await createPackage({
          name: 'فرحة',
          priceHalalas: 99000,
        });
        const edited = await send('patch', `/events/${id}`, ownerAccess)
          .send({ name: 'زفاف سارة', startsAt, packageId: larger })
          .expect(200);
        expect(edited.body.data).toMatchObject({
          name: 'زفاف سارة',
          venueName: 'قاعة النخيل',
          package: { id: larger, name: 'فرحة', priceHalalas: 99000 },
        });
        expect(
          new Date(edited.body.data.admissionOpensAt as string).getTime(),
        ).toBe(new Date(startsAt).getTime() - 3 * HOUR);
        await send('patch', `/events/${id}`, ownerAccess)
          .send({ name: null })
          .expect(400);
      });

      it('locks the package once checkout started and everything once approved', async () => {
        const created = await send('post', '/events', ownerAccess)
          .send(eventBody())
          .expect(201);
        const id: string = created.body.data.id;
        const other = await createPackage({ name: 'أثر' });

        await db.query(
          `UPDATE events SET payment_status = 'PENDING' WHERE id = $1`,
          [id],
        );
        const pending = await send('patch', `/events/${id}`, ownerAccess)
          .send({ packageId: other })
          .expect(409);
        expect(pending.body.code).toBe('events.package_locked');
        await send('patch', `/events/${id}`, ownerAccess)
          .send({ name: 'ما زال قابلاً للتعديل' })
          .expect(200);

        await db.query(
          `UPDATE events SET payment_status = 'PAID', status = 'ACTIVE', approval_status = 'APPROVED' WHERE id = $1`,
          [id],
        );
        const approved = await send('patch', `/events/${id}`, ownerAccess)
          .send({ name: 'تغيير' })
          .expect(409);
        expect(approved.body.code).toBe('events.locked');
        const read = await send('get', `/events/${id}`, ownerAccess).expect(
          200,
        );
        expect(read.body.data).toMatchObject({
          editable: false,
          packageEditable: false,
        });
      });
    });

    it('promoting an owner requires the explicit flag and ends their sessions', async () => {
      const provisioning = app.get(AdminProvisioningService);
      await expect(
        provisioning.provision('plain-owner@example.com', 'x', {
          promote: false,
        }),
      ).rejects.toThrow(/--promote/);
      expect(
        await provisioning.provision('plain-owner@example.com', 'x', {
          promote: true,
        }),
      ).toBe('promoted');
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${ownerAccess}`)
        .expect(401);
    });
  });
});
