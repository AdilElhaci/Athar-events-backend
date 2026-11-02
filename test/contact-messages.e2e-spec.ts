import type { NestExpressApplication } from '@nestjs/platform-express';
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
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const MESSAGES = '/admin/contact-messages';
const UNKNOWN_ID = '6f1c2f4e-3d4b-4f55-9a10-1c9a7a4b2e11';

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

interface MessageRow {
  id: string;
  name: string;
  phone: string;
  subject: string;
  status: string;
}

describe('Contact messages (e2e)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let db: DataSource;
  let redis: Redis;
  let adminAccess: string;
  let ownerAccess: string;

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminAccess}`);
  const list = (query = '') =>
    asAdmin(server().get(`/api${MESSAGES}${query}`)).expect(200);
  const newCount = async () =>
    (await asAdmin(server().get(`/api${MESSAGES}/new-count`)).expect(200)).body
      .data.count as number;
  const submit = (body: object) =>
    csrf(server().post('/api/contact')).send(body);

  /** Creates a message through the public form and returns its row. */
  async function createMessage(name: string, subject: string, phone: string) {
    await submit({ name, phone, subject }).expect(200);
    const res = await list(`?search=${encodeURIComponent(subject)}`);
    return res.body.data.items[0] as MessageRow;
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
      .send({ email: 'owner@example.com', name: 'سارة' })
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
  });

  beforeEach(async () => {
    await redis.flushdb(); // fresh rate-limit counters per test
  });

  afterAll(async () => {
    await app.close();
  });

  it('stores a public submission as NEW and still e-mails the inbox', async () => {
    const before = mail.sent.length;
    const row = await createMessage(
      '<b>نورة</b>',
      'أرغب بمعرفة تفاصيل باقة فرحة.',
      '0501234567',
    );
    expect(row).toMatchObject({
      name: '<b>نورة</b>', // stored as text; the dashboard renders it escaped
      phone: '966501234567',
      status: 'NEW',
    });
    expect(mail.sent.slice(before)).toHaveLength(1);
    expect(mail.sent.at(-1)!.message.kind).toBe('contact_message');
  });

  it('stores nothing for honeypot or invalid submissions', async () => {
    const before = (await list()).body.data.meta.total;
    await submit({
      name: 'بوت',
      phone: '0501234567',
      subject: 'رسالة مزعجة من برنامج آلي.',
      website: 'http://spam.example',
    }).expect(200);
    await submit({
      name: 'نورة',
      phone: '12345',
      subject: 'رقم الجوال هنا غير صحيح.',
    }).expect(400);
    expect((await list()).body.data.meta.total).toBe(before);
  });

  it('answers 401 without a session and 403 to owners on every admin route', async () => {
    const owner = (req: request.Test) =>
      req.set('Authorization', `Bearer ${ownerAccess}`);
    const routes: Array<() => request.Test> = [
      () => server().get(`/api${MESSAGES}`),
      () => server().get(`/api${MESSAGES}/new-count`),
      () => server().get(`/api${MESSAGES}/${UNKNOWN_ID}`),
      () => csrf(server().post(`/api${MESSAGES}/${UNKNOWN_ID}/read`)),
      () => csrf(server().post(`/api${MESSAGES}/${UNKNOWN_ID}/status`)),
      () => csrf(server().delete(`/api${MESSAGES}/${UNKNOWN_ID}`)),
    ];
    for (const route of routes) {
      await route().expect(401);
      await owner(route()).expect(403);
    }
  });

  it('requires CSRF headers on admin writes and validates input', async () => {
    const row = await createMessage(
      'ريم',
      'سؤال عن رفع الأسماء.',
      '0507654321',
    );
    await asAdmin(server().post(`/api${MESSAGES}/${row.id}/read`)).expect(403);
    await asAdmin(server().delete(`/api${MESSAGES}/${row.id}`)).expect(403);
    await asAdmin(csrf(server().post(`/api${MESSAGES}/${row.id}/status`)))
      .send({ status: 'ARCHIVED' })
      .expect(400);
    await asAdmin(server().get(`/api${MESSAGES}/not-a-uuid`)).expect(400);
    await asAdmin(server().get(`/api${MESSAGES}/${UNKNOWN_ID}`)).expect(404);
    await asAdmin(server().get(`/api${MESSAGES}?status=ARCHIVED`)).expect(400);
  });

  it('searches name, phone and subject literally, newest first, and filters by status', async () => {
    await createMessage(
      'هند 100%_تجربة',
      'أول رسالة للبحث الحرفي.',
      '0551112222',
    );
    await createMessage('لمى', 'ثاني رسالة للبحث الحرفي.', '0553334444');

    const names = async (query: string) =>
      ((await list(query)).body.data.items as MessageRow[]).map((m) => m.name);

    expect(
      await names(`?search=${encodeURIComponent('للبحث الحرفي')}`),
    ).toEqual(['لمى', 'هند 100%_تجربة']);
    expect(await names('?search=0553334444')).toEqual(['لمى']);
    expect(
      await names(`?search=${encodeURIComponent('+966553334444')}`),
    ).toEqual(['لمى']);
    expect(await names(`?search=${encodeURIComponent('100%_')}`)).toEqual([
      'هند 100%_تجربة',
    ]);
    expect(await names(`?search=${encodeURIComponent('_تج%')}`)).toEqual([]);

    const paged = await list('?limit=1&page=1');
    expect(paged.body.data.items).toHaveLength(1);
    expect(paged.body.data.meta.hasNext).toBe(true);

    expect(await names('?status=CLOSED')).toEqual([]);
    const fresh = (await list('?status=NEW&limit=100')).body.data.items;
    expect(fresh.length).toBeGreaterThan(0);
    expect(fresh.every((m: MessageRow) => m.status === 'NEW')).toBe(true);
  });

  it('marks read without touching later statuses and audits each change', async () => {
    const row = await createMessage('سلمى', 'متابعة حالة الطلب.', '0556667777');
    const url = `/api${MESSAGES}/${row.id}`;
    const countBefore = await newCount();

    // Viewing a message does not change it; marking it read does, once.
    const detail = await asAdmin(server().get(url)).expect(200);
    expect(detail.body.data.status).toBe('NEW');
    const read = await asAdmin(csrf(server().post(`${url}/read`))).expect(200);
    expect(read.body.data.status).toBe('READ');
    expect(await newCount()).toBe(countBefore - 1);

    const replied = await asAdmin(csrf(server().post(`${url}/status`)))
      .send({ status: 'REPLIED' })
      .expect(200);
    expect(replied.body.code).toBe('contact_message.status_updated');
    expect(replied.body.data.status).toBe('REPLIED');

    // A stale tab opening the message later must not move it back.
    const stale = await asAdmin(csrf(server().post(`${url}/read`))).expect(200);
    expect(stale.body.data.status).toBe('REPLIED');

    // Setting the same status again is a no-op.
    await asAdmin(csrf(server().post(`${url}/status`)))
      .send({ status: 'REPLIED' })
      .expect(200);

    const audit: Array<{ action: string; summary: object }> = await db.query(
      `SELECT action, summary FROM admin_actions WHERE target_id = $1 ORDER BY created_at`,
      [row.id],
    );
    expect(audit.map((a) => a.summary)).toEqual([
      { from: 'NEW', to: 'READ' },
      { from: 'READ', to: 'REPLIED' },
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/سلمى|966556667777/);
  });

  it('deletes a message permanently and audits it without personal data', async () => {
    const row = await createMessage('دانة', 'أرجو حذف بياناتي.', '0558889999');
    const url = `/api${MESSAGES}/${row.id}`;

    const res = await asAdmin(csrf(server().delete(url))).expect(200);
    expect(res.body.code).toBe('contact_message.deleted');

    await asAdmin(server().get(url)).expect(404);
    await asAdmin(csrf(server().delete(url))).expect(404);
    await asAdmin(csrf(server().post(`${url}/read`))).expect(404);
    expect(
      await db.query(`SELECT 1 FROM contact_messages WHERE id = $1`, [row.id]),
    ).toHaveLength(0);

    const audit: Array<{ action: string }> = await db.query(
      `SELECT action FROM admin_actions WHERE target_id = $1`,
      [row.id],
    );
    expect(audit.map((a) => a.action)).toEqual(['contact_message.deleted']);
  });
});
