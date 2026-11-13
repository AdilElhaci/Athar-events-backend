import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import { MailService } from '../src/modules/mail/mail.service';

const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const ORIGIN = 'http://localhost:3000';
const PHONE = '+966512345678';

describe('Public WhatsApp demo (e2e)', () => {
  let app: NestExpressApplication;
  let meta: FakeWhatsappClient;
  let redis: Redis;
  let seq = 0;

  const server = () => request(app.getHttpServer());
  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const hook = (message: object, from = PHONE) => {
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
                    id: `wamid.demo.${++seq}`,
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
  const text = (body: string, from?: string) =>
    hook({ type: 'text', text: { body } }, from);
  const button = (id: string) =>
    hook({
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id, title: 'x' },
      },
    });
  const start = async (phone = '0512345678') => {
    const res = await csrf(server().post('/api/demo/whatsapp/sessions'))
      .send({ phone })
      .expect(200);
    return res.body.data as {
      sessionId: string;
      whatsappNumber: string;
      text: string;
    };
  };
  const state = async (sessionId: string) =>
    (await server().get(`/api/demo/whatsapp/sessions/${sessionId}`).expect(200))
      .body.data.state as string;
  /** The demo answers after the webhook returns; wait for the state and the sends to land. */
  const waitFor = async (sessionId: string, expected: string, sent = 0) => {
    for (let i = 0; i < 100; i++) {
      if ((await state(sessionId)) === expected && meta.sent.length >= sent)
        return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`demo did not reach ${expected}`);
  };

  beforeAll(async () => {
    meta = new FakeWhatsappClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MailService)
      .useValue({ send: () => Promise.resolve(), sendLater: () => undefined })
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
    redis = app.get<Redis>(REDIS);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    meta.reset();
    await redis.flushdb();
  });

  it('plays the full journey: code, invitation, pass, door', async () => {
    const demo = await start();
    expect(demo.whatsappNumber).toBe('966500000000');
    expect(demo.text).toMatch(/^تجربة أثر \d{6}$/);
    expect(meta.sent).toHaveLength(0); // nothing goes out before the visitor writes
    expect(await state(demo.sessionId)).toBe('WAITING');

    await text(demo.text);
    await waitFor(demo.sessionId, 'INVITED', 1);
    expect(meta.sent).toHaveLength(1);
    const invitation = meta.sent[0];
    expect(invitation.type).toBe('buttons');
    expect(invitation.to).toBe(PHONE);
    if (invitation.type === 'buttons')
      expect(invitation.message.buttons.map((b) => b.id)).toEqual([
        'DEMO_ACCEPT',
        'DEMO_DECLINE',
      ]);

    // The door is not ready before the pass.
    await csrf(
      server().post(`/api/demo/whatsapp/sessions/${demo.sessionId}/check-in`),
    ).expect(400);

    await button('DEMO_ACCEPT');
    await waitFor(demo.sessionId, 'ACCEPTED', 2);
    expect(meta.uploads).toHaveLength(1);
    expect(meta.sent[1].type).toBe('image');

    const done = await csrf(
      server().post(`/api/demo/whatsapp/sessions/${demo.sessionId}/check-in`),
    ).expect(200);
    expect(done.body.data.state).toBe('CHECKED_IN');
    expect(meta.sent[2].type).toBe('text');
    // A second press sends nothing more.
    await csrf(
      server().post(`/api/demo/whatsapp/sessions/${demo.sessionId}/check-in`),
    ).expect(200);
    expect(meta.sent).toHaveLength(3);
  });

  it('ignores a wrong code and a code from another number', async () => {
    const demo = await start();
    await text('تجربة أثر 000000');
    await text(demo.text, '+966598765432');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await state(demo.sessionId)).toBe('WAITING');
    expect(meta.sent).toHaveLength(0);
  });

  it('declines, then can still accept', async () => {
    const demo = await start();
    await text(demo.text);
    await waitFor(demo.sessionId, 'INVITED', 1);
    await button('DEMO_DECLINE');
    await waitFor(demo.sessionId, 'DECLINED', 2);
    expect(meta.sent[1].type).toBe('text');
    await button('DEMO_ACCEPT');
    await waitFor(demo.sessionId, 'ACCEPTED', 3);
    expect(meta.sent[2].type).toBe('image');
  });

  it('ends the demo when a send is ambiguous, without resending', async () => {
    const demo = await start();
    meta.nextOutcome = { outcome: 'UNKNOWN', code: 'timeout' };
    await text(demo.text);
    await waitFor(demo.sessionId, 'FAILED');
    await text(demo.text);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(meta.sent).toHaveLength(0);
  });

  it('rejects non-Saudi numbers, unknown sessions and missing CSRF', async () => {
    await csrf(server().post('/api/demo/whatsapp/sessions'))
      .send({ phone: '+447700900123' })
      .expect(400);
    await server()
      .post('/api/demo/whatsapp/sessions')
      .send({ phone: '0512345678' })
      .expect(403);
    await server()
      .get('/api/demo/whatsapp/sessions/aaaaaaaaaaaaaaaaaaaaaaaa')
      .expect(404);
  });

  it('limits demos per number', async () => {
    for (let i = 0; i < 3; i++) await start();
    await csrf(server().post('/api/demo/whatsapp/sessions'))
      .send({ phone: '0512345678' })
      .expect(429);
  });
});
