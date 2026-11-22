import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { generateVAPIDKeys } from 'web-push';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import { PushSubscription } from '../src/modules/push/entities/push-subscription.entity';
import {
  PushResult,
  PushTarget,
  WebPushClient,
} from '../src/modules/push/web-push.client';

// The app module validates the environment when it is imported: set these first.
const VAPID = generateVAPIDKeys();
process.env.WEB_PUSH_PUBLIC_KEY = VAPID.publicKey;
process.env.WEB_PUSH_PRIVATE_KEY = VAPID.privateKey;
process.env.WHATSAPP_BOT_ENABLED = 'true';

const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'Str0ng-Passw0rd!';
const FCM = 'https://fcm.googleapis.com/fcm/send/device-';
const KEYS = {
  p256dh:
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

class FakePush {
  sent: Array<{ endpoint: string; payload: Record<string, string> }> = [];
  answer: PushResult = { ok: true };
  send(target: PushTarget, payload: string): Promise<PushResult> {
    this.sent.push({
      endpoint: target.endpoint,
      payload: JSON.parse(payload) as Record<string, string>,
    });
    return Promise.resolve(this.answer);
  }
  reset() {
    this.sent = [];
    this.answer = { ok: true };
  }
}

class CapturingMail {
  sent: Array<{ to: string; message: MailMessage }> = [];
  send(to: string, message: MailMessage) {
    this.sent.push({ to, message });
    return Promise.resolve();
  }
  sendLater(to: string, message: MailMessage) {
    this.sent.push({ to, message });
  }
}

describe('Web Push for new inbox messages (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let meta: FakeWhatsappClient;
  let push: FakePush;
  let redis: Redis;
  let adminAccess: string;
  let seq = 0;
  let phoneSeq = 0;

  const newPhone = () => `+9665${String(20_000_000 + ++phoneSeq).slice(-8)}`;
  const server = () => request(app.getHttpServer());
  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminAccess}`);
  const subscribe = (endpoint: string) =>
    csrf(asAdmin(server().post('/api/admin/push/subscriptions'))).send({
      endpoint,
      keys: KEYS,
    });
  const hook = (message: object, from: string) => {
    const raw = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: {
                messages: [
                  {
                    from: from.slice(1),
                    id: `wamid.push.${++seq}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    ...message,
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    return server()
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
  };
  const text = (from: string, body: string) =>
    hook({ type: 'text', text: { body } }, from);
  const press = (from: string, buttonId: string) =>
    hook(
      {
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: buttonId, title: 'التواصل مع الفريق' },
        },
      },
      from,
    );
  /** Pushes run after the webhook returns (and after the bot). */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
  const waitForPushes = async (count: number) => {
    for (let i = 0; i < 100; i++) {
      if (push.sent.length >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${count} pushes, got ${push.sent.length}`);
  };
  const subscriptions = () => db.getRepository(PushSubscription).find();

  beforeAll(async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const { configureApp } =
      require('../src/app.setup') as typeof import('../src/app.setup');
    /* eslint-enable @typescript-eslint/no-require-imports */
    meta = new FakeWhatsappClient();
    push = new FakePush();
    const mail = new CapturingMail();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue(mail)
      .overrideProvider(WhatsappClient)
      .useValue(meta)
      .overrideProvider(WebPushClient)
      .useValue(push)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureApp(app);
    await app.init();
    db = app.get(DataSource);
    await db.dropDatabase();
    await db.runMigrations();
    redis = app.get<Redis>(REDIS);
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
    const login = await csrf(server().post('/api/auth/login'))
      .send({ email: 'admin@example.com', password: PASSWORD })
      .expect(200);
    adminAccess = login.body.data.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    meta.reset();
    push.reset();
    await redis.flushdb();
    await db.getRepository(PushSubscription).clear();
  });

  it('gives the VAPID key to admins only', async () => {
    const res = await asAdmin(
      server().get('/api/admin/push/public-key'),
    ).expect(200);
    expect(res.body.data.publicKey).toBe(VAPID.publicKey);
    await server().get('/api/admin/push/public-key').expect(401);
  });

  it('accepts browser push services only, once per device', async () => {
    await subscribe('http://localhost:4000/internal').expect(400);
    await subscribe('https://evil.example.com/push').expect(400);
    await subscribe('https://fcm.googleapis.com:8443/x').expect(400);
    await subscribe(`${FCM}a`).expect(200);
    await subscribe(`${FCM}a`).expect(200);
    await subscribe('https://web.push.apple.com/QGuQyavXut').expect(200);
    expect(await subscriptions()).toHaveLength(2);

    await csrf(asAdmin(server().post('/api/admin/push/subscriptions/remove')))
      .send({ endpoint: `${FCM}a` })
      .expect(200);
    expect((await subscriptions()).map((s) => s.endpoint)).toEqual([
      'https://web.push.apple.com/QGuQyavXut',
    ]);
  });

  it('sends a test notification to the admin’s own devices', async () => {
    await subscribe(`${FCM}t`).expect(200);
    const res = await csrf(
      asAdmin(server().post('/api/admin/push/test')),
    ).expect(200);
    expect(res.body.data.delivered).toBe(1);
    expect(push.sent[0].payload.url).toBe('/dashboard/inbox');
  });

  it('stays quiet when the bot answered, rings on a handoff to the team', async () => {
    await subscribe(`${FCM}b`).expect(200);
    const phone = newPhone();
    await text(phone, 'السلام عليكم');
    await settle();
    expect(meta.sent.length).toBe(1); // the menu
    expect(push.sent).toHaveLength(0);

    await press(phone, 'BOT_HUMAN');
    await waitForPushes(1);
    const digits = phone.slice(1);
    expect(push.sent[0]).toEqual({
      endpoint: `${FCM}b`,
      payload: {
        title: phone,
        body: 'التواصل مع الفريق',
        url: `/dashboard/inbox?c=${digits}`,
        tag: `inbox-${digits}`,
      },
    });
  });

  it('announces a message the bot does not handle, once per conversation per 30 s', async () => {
    await subscribe(`${FCM}r`).expect(200);
    const phone = newPhone();
    await hook(
      { type: 'reaction', reaction: { message_id: 'wamid.x', emoji: '👍' } },
      phone,
    );
    await waitForPushes(1);
    expect(push.sent[0].payload.body).toBe('تفاعل 👍');
    await hook(
      { type: 'reaction', reaction: { message_id: 'wamid.y', emoji: '❤️' } },
      phone,
    );
    await settle();
    expect(push.sent).toHaveLength(1);
  });

  it('never announces an RSVP button', async () => {
    await subscribe(`${FCM}v`).expect(200);
    await hook(
      {
        type: 'button',
        button: { payload: 'RSVP_ACCEPT', text: 'سأحضر' },
        context: { id: 'wamid.unknown' },
      },
      newPhone(),
    );
    await settle();
    expect(push.sent).toHaveLength(0);
  });

  it('drops a device the push service says is gone', async () => {
    await subscribe(`${FCM}g`).expect(200);
    push.answer = { ok: false, status: 410 };
    await hook(
      { type: 'reaction', reaction: { message_id: 'wamid.z', emoji: '👍' } },
      newPhone(),
    );
    await waitForPushes(1);
    await settle();
    expect(await subscriptions()).toHaveLength(0);
  });
});
