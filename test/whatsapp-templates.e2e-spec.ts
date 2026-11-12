import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AdminAction } from '../src/modules/admin-actions/admin-action.entity';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const ROUTE = '/api/admin/whatsapp/templates';

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

const template = (name: string, language: string, status: string) => ({
  id: `${name}_${language}`,
  name,
  language,
  category: 'MARKETING',
  status,
  rejectedReason: null,
  body: 'مرحباً {{1}}',
  buttons: ['قبول', 'اعتذار'],
});

describe('Admin WhatsApp templates (e2e)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let meta: FakeWhatsappClient;
  let adminAccess: string;
  let ownerAccess: string;
  let db: DataSource;

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const asAdmin = () =>
    server().get(ROUTE).set('Authorization', `Bearer ${adminAccess}`);
  const bearer = (req: request.Test, token = adminAccess) =>
    req.set('Authorization', `Bearer ${token}`);
  const create = (body: object, token = adminAccess) =>
    bearer(csrf(server().post(ROUTE)), token).send(body);
  const remove = (id: string, name: string, token = adminAccess) =>
    bearer(csrf(server().delete(`${ROUTE}/${id}?name=${name}`)), token);
  const draft = {
    name: 'event_reminder',
    language: 'ar',
    category: 'UTILITY',
    headerText: 'تذكير بالمناسبة',
    body: 'أهلاً {{1}}، نذكّرك بموعد {{2}} غداً.',
    bodyExamples: ['سارة', 'حفل الزفاف'],
    footerText: 'أثر للمناسبات',
    quickReplies: ['تم', 'تواصل معنا'],
  };

  async function login(email: string) {
    const res = await csrf(server().post('/api/auth/login'))
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    mail = new CapturingMail();
    meta = new FakeWhatsappClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(WhatsappClient)
      .useValue(meta)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
    db = app.get(DataSource);
    await db.dropDatabase();
    await db.runMigrations();
    await app.get<Redis>(REDIS).flushdb();

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

  beforeEach(() => {
    meta.reset();
    meta.configured = true;
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a session and 403 to owners', async () => {
    await server().get(ROUTE).expect(401);
    await server()
      .get(ROUTE)
      .set('Authorization', `Bearer ${ownerAccess}`)
      .expect(403);
  });

  it('lists templates sorted by name and matches the Arabic invitation template', async () => {
    meta.templates = [
      template('zz_other', 'ar', 'PENDING'),
      template('athar_invitation', 'en_US', 'REJECTED'),
      template('athar_invitation', 'ar', 'APPROVED'),
    ];
    const res = await asAdmin().expect(200);
    const data = res.body.data;
    expect(data.configured).toBe(true);
    expect(data.invitationTemplate).toEqual({
      name: 'athar_invitation',
      configuredStatus: 'PENDING',
      metaStatus: 'APPROVED',
    });
    expect(data.templates.map((t: { name: string }) => t.name)).toEqual([
      'athar_invitation',
      'athar_invitation',
      'zz_other',
    ]);
  });

  it('reports a missing invitation template at Meta', async () => {
    meta.templates = [template('zz_other', 'ar', 'APPROVED')];
    const res = await asAdmin().expect(200);
    expect(res.body.data.invitationTemplate.metaStatus).toBeNull();
  });

  it('answers configured: false when the WABA is not set', async () => {
    meta.configured = false;
    const res = await asAdmin().expect(200);
    expect(res.body.data).toMatchObject({ configured: false, templates: [] });
  });

  it('answers 503 with an Arabic message when Meta fails', async () => {
    meta.templatesError = 'meta_190';
    const res = await asAdmin().expect(503);
    expect(res.body.code).toBe('whatsapp.templates_unavailable');
  });

  it('only admins create or delete, and writes need the CSRF headers', async () => {
    await csrf(server().post(ROUTE)).send(draft).expect(401);
    await create(draft, ownerAccess).expect(403);
    await bearer(server().post(ROUTE)).send(draft).expect(403);
    await remove('123', 'event_reminder', ownerAccess).expect(403);
    await bearer(server().delete(`${ROUTE}/123?name=event_reminder`)).expect(
      403,
    );
    expect(meta.created).toHaveLength(0);
    expect(meta.deleted).toHaveLength(0);
  });

  it('submits a template to Meta, audits it, and lists it as pending', async () => {
    const res = await create(draft).expect(200);
    expect(res.body.code).toBe('whatsapp.template_created');
    expect(meta.created).toEqual([draft]);
    const listed = (await asAdmin().expect(200)).body.data.templates;
    expect(listed).toEqual([
      expect.objectContaining({ name: 'event_reminder', status: 'PENDING' }),
    ]);
    const action = await db
      .getRepository(AdminAction)
      .findOneByOrFail({ action: 'whatsapp.template_create' });
    expect(action.summary).toMatchObject({
      name: 'event_reminder',
      language: 'ar',
      category: 'UTILITY',
    });
  });

  it('treats empty header and footer as none', async () => {
    await create({ ...draft, headerText: '  ', footerText: '' }).expect(200);
    expect(meta.created[0].headerText).toBeUndefined();
    expect(meta.created[0].footerText).toBeUndefined();
  });

  it('validates input before calling Meta', async () => {
    const bad = async (patch: object, code: string) => {
      const res = await create({ ...draft, ...patch }).expect(400);
      expect(res.body.code).toBe(code);
    };
    await bad({ name: 'Event Reminder' }, 'common.validation');
    await bad({ language: 'fr' }, 'common.validation');
    await bad({ category: 'AUTHENTICATION' }, 'common.validation');
    await bad({ quickReplies: ['a', 'b', 'c', 'd'] }, 'common.validation');
    await bad({ quickReplies: ['x'.repeat(26)] }, 'common.validation');
    await bad({ body: 'x'.repeat(1025) }, 'common.validation');
    await bad(
      { bodyExamples: ['سارة'] },
      'whatsapp.template_variables_invalid',
    );
    await bad(
      { body: 'أهلاً {{1}} و {{3}} غداً.' },
      'whatsapp.template_variables_invalid',
    );
    await bad(
      { body: '{{1}} نذكّرك بموعد {{2}} غداً.' },
      'whatsapp.template_variables_invalid',
    );
    await bad(
      { headerText: 'مرحباً {{1}}' },
      'whatsapp.template_header_invalid',
    );
    await bad({ footerText: 'سطر\nثانٍ' }, 'whatsapp.template_header_invalid');
    expect(meta.created).toHaveLength(0);
  });

  it('refuses to create or delete the invitation template', async () => {
    const res = await create({ ...draft, name: 'athar_invitation' }).expect(
      409,
    );
    expect(res.body.code).toBe('whatsapp.template_reserved');
    await remove('123', 'athar_invitation').expect(409);
    expect(meta.created).toHaveLength(0);
    expect(meta.deleted).toHaveLength(0);
  });

  it("maps Meta's answers: exists 409, rejection 422 with Meta's reason, outage 503", async () => {
    meta.nextWriteFailure = {
      ok: false,
      reason: 'exists',
      code: 'meta_100',
    };
    expect((await create(draft).expect(409)).body.code).toBe(
      'whatsapp.template_exists',
    );
    meta.nextWriteFailure = {
      ok: false,
      reason: 'rejected',
      code: 'meta_100',
      userMessage: 'Too many variables for the text length',
    };
    const rejected = await create(draft).expect(422);
    expect(rejected.body.code).toBe('whatsapp.template_create_failed');
    expect(rejected.body.error).toEqual([
      'Too many variables for the text length',
    ]);
    meta.nextWriteFailure = { ok: false, reason: 'network', code: 'meta_500' };
    expect((await create(draft).expect(503)).body.code).toBe(
      'whatsapp.unreachable',
    );
  });

  it('deletes a template by Meta id and name, and audits it', async () => {
    await create(draft).expect(200);
    const id = meta.templates[0].id;
    await remove('not-a-number', 'event_reminder').expect(400);
    await remove(id, 'Bad Name').expect(400);
    const res = await remove(id, 'event_reminder').expect(200);
    expect(res.body.code).toBe('whatsapp.template_deleted');
    expect(meta.deleted).toEqual([{ id, name: 'event_reminder' }]);
    expect((await asAdmin().expect(200)).body.data.templates).toEqual([]);
    await expect(
      db
        .getRepository(AdminAction)
        .countBy({ action: 'whatsapp.template_delete' }),
    ).resolves.toBe(1);
  });
});
