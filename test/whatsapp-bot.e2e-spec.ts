import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  Event,
  EventPaymentStatus,
} from '../src/modules/events/entities/event.entity';
import { Guest, GuestRsvp } from '../src/modules/guests/entities/guest.entity';
import { InvitationContent } from '../src/modules/invitations/entities/invitation-content.entity';
import { WhatsappInbound } from '../src/modules/invitations/entities/whatsapp-inbound.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
import {
  WhatsappReply,
  WhatsappReplySource,
} from '../src/modules/invitations/entities/whatsapp-reply.entity';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import { WhatsappSenderService } from '../src/modules/invitations/whatsapp/whatsapp-sender.service';
import { MailService } from '../src/modules/mail/mail.service';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

// The bot is off by default; the app module reads the environment when it is imported.
process.env.WHATSAPP_BOT_ENABLED = 'true';

const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const ORIGIN = 'http://localhost:3000';
const DAY_MS = 86_400_000;

describe('WhatsApp auto-reply menu, D-49 (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let meta: FakeWhatsappClient;
  let redis: Redis;
  let sender: WhatsappSenderService;
  let ownerId: string;
  let seq = 0;
  let phoneSeq = 0;

  /** A fresh number per test, so cooldowns and silences never leak between tests. */
  const newPhone = () => `+9665${String(10_000_000 + ++phoneSeq).slice(-8)}`;
  const server = () => request(app.getHttpServer());
  const hook = (message: object, from: string, id = `wamid.bot.${++seq}`) => {
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
                    id,
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
      .expect(200)
      .then(() => id);
  };
  const text = (from: string, body = 'السلام عليكم', id?: string) =>
    hook({ type: 'text', text: { body } }, from, id);
  const press = (from: string, buttonId: string) =>
    hook(
      {
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: buttonId, title: 'x' },
        },
      },
      from,
    );
  const to = (phone: string) => meta.sent.filter((m) => m.to === phone);
  /** The bot answers after the webhook returns: wait until the number got `count` messages. */
  const waitFor = async (phone: string, count: number) => {
    for (let i = 0; i < 100; i++) {
      if (to(phone).length >= count) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`expected ${count} messages, got ${to(phone).length}`);
  };
  const quiet = () => new Promise((resolve) => setTimeout(resolve, 150));
  const buttonIds = (phone: string, index: number) => {
    const sent = to(phone)[index];
    return sent.type === 'buttons' ? sent.message.buttons.map((b) => b.id) : [];
  };
  const body = (phone: string, index: number) => {
    const sent = to(phone)[index];
    return sent.type === 'text' ? sent.body : '';
  };
  const inbound = (id: string) =>
    db
      .getRepository(WhatsappInbound)
      .findOneByOrFail({ providerMessageId: id });

  /** A guest of an upcoming paid event with an approved invitation that was sent. */
  async function invitedGuest(
    phone: string,
    opts: { startsInMs?: number; closesInMs?: number } = {},
  ) {
    // Invited before the start (the sender refuses after it); moved to `startsInMs` afterwards.
    const startsAt = new Date(Date.now() + 10 * DAY_MS);
    const event = await db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة وعبدالله',
        startsAt,
        venueName: 'قاعة الضيافة',
        venueMapUrl: 'https://maps.example.com/venue',
        packageName: 'فرحة',
        invitationAllowance: 10,
        extraMargin: 2,
        priceHalalas: 150_000,
        currency: 'SAR',
        paymentStatus: EventPaymentStatus.PAID,
        admissionOpensAt: new Date(startsAt.getTime() - 3_600_000),
        admissionClosesAt: new Date(startsAt.getTime() + 3_600_000),
      }),
    );
    const content = await db.getRepository(InvitationContent).save(
      db.getRepository(InvitationContent).create({
        eventId: event.id,
        version: 1,
        templateName: 'athar_invitation',
        templateLanguage: 'ar',
        variables: {
          eventName: 'زفاف نورة وعبدالله',
          dateText: 'الخميس 12 نوفمبر 2026، 8:00 مساءً',
          venue: 'قاعة الضيافة',
        },
        renderedPreview: '-',
        contentHash: '0'.repeat(64),
        createdByUserId: ownerId,
        approvedAt: new Date(),
        approvedByUserId: ownerId,
      }),
    );
    await db
      .getRepository(Event)
      .update(event.id, { approvedContentId: content.id });
    const guest = await db.getRepository(Guest).save(
      db.getRepository(Guest).create({
        eventId: event.id,
        name: 'محمد العتيبي',
        phone,
      }),
    );
    const result = await sender.sendTracerInvitation(guest.id);
    expect(result.state).toBe(WhatsappMessageState.SENT);
    if (opts.startsInMs !== undefined) {
      const moved = new Date(Date.now() + opts.startsInMs);
      await db.getRepository(Event).update(event.id, {
        startsAt: moved,
        admissionOpensAt: new Date(moved.getTime() - 3_600_000),
        admissionClosesAt: new Date(
          moved.getTime() + (opts.closesInMs ?? 3_600_000),
        ),
      });
    }
    meta.reset();
    return { guest, event };
  }

  beforeAll(async () => {
    // Required here, after the variable above is set: the app module validates the environment on load.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const { configureApp } =
      require('../src/app.setup') as typeof import('../src/app.setup');
    /* eslint-enable @typescript-eslint/no-require-imports */
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
    db = app.get(DataSource);
    await db.dropDatabase();
    await db.runMigrations();
    redis = app.get<Redis>(REDIS);
    sender = app.get(WhatsappSenderService);
    const owner = await db.getRepository(User).save(
      db.getRepository(User).create({
        type: UserType.OWNER,
        status: UserStatus.ACTIVE,
        name: 'صاحب المناسبة',
        email: 'owner@example.com',
      }),
    );
    ownerId = owner.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    meta.reset();
    await redis.flushdb();
  });

  it('answers anyone else with the general menu, records it and reads the message', async () => {
    const phone = newPhone();
    const id = await text(phone);
    await waitFor(phone, 1);
    expect(buttonIds(phone, 0)).toEqual([
      'BOT_ABOUT',
      'BOT_PACKAGES',
      'BOT_HUMAN',
    ]);

    const replies = await db
      .getRepository(WhatsappReply)
      .findBy({ toPhone: phone });
    expect(replies).toHaveLength(1);
    expect(replies[0].source).toBe(WhatsappReplySource.BOT);
    expect(replies[0].sentByUserId).toBeNull();
    expect(replies[0].state).toBe(WhatsappMessageState.SENT);
    expect(replies[0].body).toContain('[عن أثر]');
    expect((await inbound(id)).seenAt).not.toBeNull();
  });

  it('sends the menu once per minute however many messages arrive', async () => {
    const phone = newPhone();
    await Promise.all([
      text(phone),
      text(phone, 'مرحبا'),
      text(phone, 'قائمة'),
    ]);
    await waitFor(phone, 1);
    await quiet();
    expect(to(phone)).toHaveLength(1);
  });

  it('answers a Meta retry of the same message once', async () => {
    const phone = newPhone();
    await text(phone, 'السلام عليكم', 'wamid.bot.retry');
    await text(phone, 'السلام عليكم', 'wamid.bot.retry');
    await waitFor(phone, 1);
    await quiet();
    expect(to(phone)).toHaveLength(1);
  });

  it('answers media with the menu too', async () => {
    const phone = newPhone();
    await hook({ type: 'image', image: { id: 'media.1' } }, phone);
    await waitFor(phone, 1);
    expect(to(phone)[0].type).toBe('buttons');
  });

  it('about and packages link to the site', async () => {
    const phone = newPhone();
    await press(phone, 'BOT_ABOUT');
    await waitFor(phone, 1);
    expect(body(phone, 0)).toContain(`${ORIGIN}/how-it-works`);
    await press(phone, 'BOT_PACKAGES');
    await waitFor(phone, 2);
    expect(body(phone, 1)).toContain(`${ORIGIN}/packages`);
  });

  it('a guest gets the occasion menu and its details; no pass before accepting', async () => {
    const phone = newPhone();
    await invitedGuest(phone);
    await text(phone);
    await waitFor(phone, 1);
    expect(buttonIds(phone, 0)).toEqual(['BOT_DETAILS', 'BOT_HUMAN']);

    await press(phone, 'BOT_DETAILS');
    await waitFor(phone, 2);
    const details = body(phone, 1);
    expect(details).toContain('زفاف نورة وعبدالله');
    expect(details).toContain('الخميس 12 نوفمبر 2026، 8:00 مساءً');
    expect(details).toContain('قاعة الضيافة');
    expect(details).toContain('https://maps.example.com/venue');

    // Pressing the pass button anyway shows the menu again.
    await press(phone, 'BOT_PASS');
    await waitFor(phone, 3);
    expect(buttonIds(phone, 2)).toEqual(['BOT_DETAILS', 'BOT_HUMAN']);
  });

  it('an accepted guest gets a new pass that replaces the earlier one', async () => {
    const phone = newPhone();
    const { guest } = await invitedGuest(phone);
    await db.getRepository(Guest).update(guest.id, {
      rsvp: GuestRsvp.ACCEPTED,
      qrVersion: 1,
      qrTokenHash: 'a'.repeat(64),
    });
    await text(phone);
    await waitFor(phone, 1);
    expect(buttonIds(phone, 0)).toEqual([
      'BOT_DETAILS',
      'BOT_PASS',
      'BOT_HUMAN',
    ]);

    await press(phone, 'BOT_PASS');
    await waitFor(phone, 2);
    expect(to(phone)[1].type).toBe('image');
    const after = await db
      .getRepository(Guest)
      .findOneByOrFail({ id: guest.id });
    expect(after.qrVersion).toBe(2);
    expect(after.qrTokenHash).not.toBe('a'.repeat(64));
    const qrs = await db
      .getRepository(WhatsappMessage)
      .findBy({ guestId: guest.id, kind: WhatsappMessageKind.QR });
    expect(qrs.map((q) => q.state)).toEqual([WhatsappMessageState.SENT]);
  });

  it('limits passes per guest per day', async () => {
    const phone = newPhone();
    const { guest } = await invitedGuest(phone);
    await db
      .getRepository(Guest)
      .update(guest.id, { rsvp: GuestRsvp.ACCEPTED });
    for (let i = 1; i <= 3; i++) {
      await press(phone, 'BOT_PASS');
      await waitFor(phone, i);
    }
    expect(to(phone).map((m) => m.type)).toEqual(['image', 'image', 'text']);
  });

  it('after the start: details until admission closes, but no pass', async () => {
    const phone = newPhone();
    const { guest } = await invitedGuest(phone, {
      startsInMs: -3_600_000,
      closesInMs: 3 * 3_600_000,
    });
    await db
      .getRepository(Guest)
      .update(guest.id, { rsvp: GuestRsvp.ACCEPTED });
    await text(phone);
    await waitFor(phone, 1);
    expect(buttonIds(phone, 0)).toEqual(['BOT_DETAILS', 'BOT_HUMAN']);
  });

  it('a guest of an occasion whose admission closed is answered as anyone else', async () => {
    const phone = newPhone();
    await invitedGuest(phone, {
      startsInMs: -5 * 3_600_000,
      closesInMs: 3_600_000,
    });
    await text(phone);
    await waitFor(phone, 1);
    expect(buttonIds(phone, 0)).toEqual([
      'BOT_ABOUT',
      'BOT_PACKAGES',
      'BOT_HUMAN',
    ]);
  });

  it('handoff: confirms, leaves the message unread, then stays silent', async () => {
    const phone = newPhone();
    const id = await press(phone, 'BOT_HUMAN');
    await waitFor(phone, 1);
    expect(to(phone)[0].type).toBe('text');
    expect((await inbound(id)).seenAt).toBeNull();

    const later = await text(phone, 'عندي سؤال عن الباقات');
    await press(phone, 'BOT_ABOUT');
    await quiet();
    expect(to(phone)).toHaveLength(1);
    expect((await inbound(later)).seenAt).toBeNull();
  });

  it('stays silent after an admin answered the number', async () => {
    const phone = newPhone();
    await db.getRepository(WhatsappReply).insert({
      source: WhatsappReplySource.ADMIN,
      sentByUserId: ownerId,
      requestId: '00000000-0000-4000-8000-000000000001',
      toPhone: phone,
      body: 'أهلًا، كيف نقدر نساعدك؟',
      state: WhatsappMessageState.SENT,
    });
    await text(phone);
    await quiet();
    expect(to(phone)).toHaveLength(0);
  });

  it('does not answer an RSVP button: that flow sends the pass', async () => {
    const phone = newPhone();
    await invitedGuest(phone);
    const invitation = await db.getRepository(WhatsappMessage).findOneByOrFail({
      kind: WhatsappMessageKind.INVITATION,
      guestId: (await db.getRepository(Guest).findOneByOrFail({ phone })).id,
    });
    await hook(
      {
        type: 'button',
        context: { from: '15556393093', id: invitation.providerMessageId },
        button: { payload: 'RSVP_ACCEPT', text: 'سأحضر' },
      },
      phone,
    );
    await waitFor(phone, 1);
    await quiet();
    expect(to(phone).map((m) => m.type)).toEqual(['image']);
  });

  it('stays silent while a public demo runs on the number', async () => {
    const res = await server()
      .post('/api/demo/whatsapp/sessions')
      .set('Origin', ORIGIN)
      .set('X-Requested-With', 'athar-events')
      .send({ phone: '0512999999' })
      .expect(200);
    await text('+966512999999', 'السلام عليكم');
    await text('+966512999999', (res.body.data as { text: string }).text);
    await waitFor('+966512999999', 1);
    await quiet();
    expect(to('+966512999999').map((m) => m.type)).toEqual(['buttons']);
    const sent = to('+966512999999')[0];
    if (sent.type === 'buttons')
      expect(sent.message.buttons[0].id).toBe('DEMO_ACCEPT');
  });

  it('an ambiguous send is recorded and never repeated', async () => {
    const phone = newPhone();
    meta.nextOutcome = { outcome: 'UNKNOWN', code: 'timeout' };
    const id = await text(phone);
    await quiet();
    const [reply] = await db
      .getRepository(WhatsappReply)
      .findBy({ toPhone: phone });
    expect(reply.state).toBe(WhatsappMessageState.UNKNOWN);
    expect(meta.sent).toHaveLength(0);
    expect((await inbound(id)).seenAt).toBeNull();
  });
});
