import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
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

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const asAdmin = () =>
    server().get(ROUTE).set('Authorization', `Bearer ${adminAccess}`);

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
    const db = app.get(DataSource);
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
});
