import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashQrToken } from '../src/modules/checkin/qr-token';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  Event,
  EventPaymentStatus,
} from '../src/modules/events/entities/event.entity';
import { Guest, GuestRsvp } from '../src/modules/guests/entities/guest.entity';
import { InvitationContent } from '../src/modules/invitations/entities/invitation-content.entity';
import {
  WhatsappInbound,
  WhatsappInboundOutcome,
} from '../src/modules/invitations/entities/whatsapp-inbound.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import {
  TracerError,
  WhatsappSenderService,
} from '../src/modules/invitations/whatsapp/whatsapp-sender.service';
import { WhatsappSweeperJob } from '../src/modules/invitations/whatsapp/whatsapp-sweeper.job';
import { MailService } from '../src/modules/mail/mail.service';
import { WebhookReceipt } from '../src/modules/payments/entities/webhook-receipt.entity';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN!;
const DAY_MS = 86_400_000;
const PHONE = '+966512345678';

describe('WhatsApp tracer: send, webhook, RSVP, QR (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let meta: FakeWhatsappClient;
  let sender: WhatsappSenderService;
  let ownerId: string;
  let inboundSeq = 0;

  const server = () => request(app.getHttpServer());
  const sign = (raw: string, secret = APP_SECRET) =>
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  const post = (body: object, signature?: string) => {
    const raw = JSON.stringify(body);
    return server()
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature ?? sign(raw))
      .send(raw);
  };
  const envelope = (value: object) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba', changes: [{ field: 'messages', value }] }],
  });
  const statusHook = (id: string, status: string) =>
    post(
      envelope({
        statuses: [
          {
            id,
            status,
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: PHONE.slice(1),
          },
        ],
      }),
    ).expect(200);
  const replyHook = (
    contextId: string,
    payload: string,
    opts: { from?: string; id?: string } = {},
  ) => {
    const id = opts.id ?? `wamid.in.${++inboundSeq}`;
    return post(
      envelope({
        messages: [
          {
            from: (opts.from ?? PHONE).slice(1),
            id,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'button',
            context: { from: '15556393093', id: contextId },
            button: { payload, text: 'x' },
          },
        ],
      }),
    )
      .expect(200)
      .then(() => id);
  };
  const messages = () => db.getRepository(WhatsappMessage);
  const reloadGuest = (id: string) =>
    db.getRepository(Guest).findOneByOrFail({ id });
  const inbound = (id: string) =>
    db
      .getRepository(WhatsappInbound)
      .findOneByOrFail({ providerMessageId: id });

  /** Waits for the post-commit QR kick to finish. */
  async function settle(guestId: string) {
    for (let i = 0; i < 50; i++) {
      const open = await messages().countBy([
        { guestId, state: WhatsappMessageState.QUEUED },
        { guestId, state: WhatsappMessageState.SENDING },
      ]);
      if (!open) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('QR intent did not settle');
  }

  async function createGuest(
    opts: { phone?: string; startsInDays?: number; approved?: boolean } = {},
  ) {
    const startsAt = new Date(Date.now() + (opts.startsInDays ?? 10) * DAY_MS);
    const event = await db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة وعبدالله',
        startsAt,
        venueName: 'قاعة الضيافة',
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
    if (opts.approved !== false) {
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
    }
    return db.getRepository(Guest).save(
      db.getRepository(Guest).create({
        eventId: event.id,
        name: 'محمد العتيبي',
        phone: opts.phone ?? PHONE,
      }),
    );
  }

  /** A guest with a sent invitation; returns the guest and the invitation wamid. */
  async function invited(opts: { phone?: string } = {}) {
    const guest = await createGuest(opts);
    const result = await sender.sendTracerInvitation(guest.id);
    expect(result.state).toBe(WhatsappMessageState.SENT);
    const intent = await messages().findOneByOrFail({ id: result.intentId });
    return { guest, wamid: intent.providerMessageId! };
  }

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
    db = app.get(DataSource);
    await db.dropDatabase();
    await db.runMigrations();
    await app.get<Redis>(REDIS).flushdb();
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

  beforeEach(() => meta.reset());

  describe('handshake and signature', () => {
    it('echoes the challenge only for the right verify token', async () => {
      const ok = await server()
        .get('/api/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': VERIFY_TOKEN,
          'hub.challenge': '1158201444',
        })
        .expect(200);
      expect(ok.text).toBe('1158201444');
      expect(ok.headers['content-type']).toMatch(/text\/plain/);

      await server()
        .get('/api/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'wrong-token-0123456789',
          'hub.challenge': '1',
        })
        .expect(403);
    });

    it('refuses a missing, malformed or wrong signature and changes nothing', async () => {
      const body = envelope({
        statuses: [{ id: 'wamid.x', status: 'read', timestamp: '1' }],
      });
      const raw = JSON.stringify(body);
      await post(body, '').expect(401);
      await post(body, 'sha256=nothex').expect(401);
      await post(body, sign(raw, 'another-secret-0123456789')).expect(401);
      // A valid signature over different bytes (re-serialised body) also fails.
      await post(body, sign(raw + ' ')).expect(401);
    });
  });

  describe('invitation send (tracer step 1–2)', () => {
    it('sends the approved template with the guest name and RSVP payloads, once', async () => {
      const guest = await createGuest();
      const first = await sender.sendTracerInvitation(guest.id);
      expect(first.state).toBe(WhatsappMessageState.SENT);
      expect(meta.sent).toHaveLength(1);
      const sent = meta.sent[0];
      expect(sent.type).toBe('template');
      if (sent.type !== 'template') return;
      expect(sent.to).toBe(PHONE);
      expect(sent.template).toEqual({
        name: 'athar_invitation',
        language: 'ar',
        bodyParameters: [
          'محمد العتيبي',
          'زفاف نورة وعبدالله',
          'الخميس 12 نوفمبر 2026، 8:00 مساءً',
          'قاعة الضيافة',
        ],
        quickReplyPayloads: ['RSVP_ACCEPT', 'RSVP_DECLINE'],
      });
      const intent = await messages().findOneByOrFail({ id: first.intentId });
      expect(intent.providerMessageId).toBe(sent.id);
      expect(intent.deliveryStatus).toBe(WhatsappDeliveryStatus.SENT);

      // Same guest and content version: the logical key holds, nothing is sent again.
      const second = await sender.sendTracerInvitation(guest.id);
      expect(second.intentId).toBe(first.intentId);
      expect(meta.sent).toHaveLength(1);
    });

    it('refuses an unapproved or started event', async () => {
      const unapproved = await createGuest({ approved: false });
      await expect(
        sender.sendTracerInvitation(unapproved.id),
      ).rejects.toBeInstanceOf(TracerError);
      const started = await createGuest({ startsInDays: -1 });
      await expect(
        sender.sendTracerInvitation(started.id),
      ).rejects.toBeInstanceOf(TracerError);
      expect(meta.sent).toHaveLength(0);
    });

    it('records UNKNOWN and never resends it; RETRY goes back to the queue', async () => {
      const unknownGuest = await createGuest();
      meta.nextOutcome = { outcome: 'UNKNOWN', code: 'TimeoutError' };
      const unknown = await sender.sendTracerInvitation(unknownGuest.id);
      expect(unknown.state).toBe(WhatsappMessageState.UNKNOWN);

      const retryGuest = await createGuest();
      meta.nextOutcome = { outcome: 'RETRY', code: 'meta_130429' };
      const retry = await sender.sendTracerInvitation(retryGuest.id);
      expect(retry.state).toBe(WhatsappMessageState.QUEUED);

      await app.get(WhatsappSweeperJob).run(-1);
      expect(
        (await messages().findOneByOrFail({ id: retry.intentId })).state,
      ).toBe(WhatsappMessageState.SENT);
      expect(
        (await messages().findOneByOrFail({ id: unknown.intentId })).state,
      ).toBe(WhatsappMessageState.UNKNOWN);
      expect(meta.sent.map((m) => m.to)).toEqual([PHONE]);
    });

    it('turns a stale SENDING claim into UNKNOWN', async () => {
      const { guest } = await invited();
      const intent = await messages().findOneByOrFail({ guestId: guest.id });
      await messages().update(intent.id, {
        state: WhatsappMessageState.SENDING,
        claimedAt: new Date(Date.now() - 5 * 60_000),
      });
      await app.get(WhatsappSweeperJob).run();
      const after = await messages().findOneByOrFail({ id: intent.id });
      expect(after.state).toBe(WhatsappMessageState.UNKNOWN);
      expect(after.lastErrorCode).toBe('stale_claim');
    });
  });

  describe('status webhooks (tracer step 5)', () => {
    it('moves forward only, tolerates order and replays', async () => {
      const { guest, wamid } = await invited();
      const load = () => messages().findOneByOrFail({ guestId: guest.id });

      await statusHook(wamid, 'read'); // arrives before "delivered"
      let intent = await load();
      expect(intent.deliveryStatus).toBe(WhatsappDeliveryStatus.READ);
      expect(intent.deliveredAt).not.toBeNull();
      expect(intent.readAt).not.toBeNull();

      await statusHook(wamid, 'delivered');
      await statusHook(wamid, 'read'); // replay
      await statusHook(wamid, 'failed'); // never after delivery
      intent = await load();
      expect(intent.deliveryStatus).toBe(WhatsappDeliveryStatus.READ);
      expect(intent.failedAt).toBeNull();
    });

    it('records a failure from SENT with the provider code only', async () => {
      const { guest, wamid } = await invited();
      await post(
        envelope({
          statuses: [
            {
              id: wamid,
              status: 'failed',
              timestamp: String(Math.floor(Date.now() / 1000)),
              errors: [{ code: 131026, title: 'Message undeliverable' }],
            },
          ],
        }),
      ).expect(200);
      const intent = await messages().findOneByOrFail({ guestId: guest.id });
      expect(intent.deliveryStatus).toBe(WhatsappDeliveryStatus.FAILED);
      expect(intent.lastErrorCode).toBe('meta_131026');
      const receipt = await db
        .getRepository(WebhookReceipt)
        .findOneByOrFail({ dedupeKey: `${wamid}:FAILED` });
      expect(receipt.errorCode).toBe('meta_131026');
    });

    it('keeps the failure code of a message the platform did not send', async () => {
      const wamid = 'wamid.manual.1';
      await post(
        envelope({
          statuses: [
            {
              id: wamid,
              status: 'failed',
              timestamp: String(Math.floor(Date.now() / 1000)),
              errors: [{ code: 131047 }],
            },
          ],
        }),
      ).expect(200);
      const receipt = await db
        .getRepository(WebhookReceipt)
        .findOneByOrFail({ dedupeKey: `${wamid}:FAILED` });
      expect(receipt.outcome).toBe('no_change');
      expect(receipt.errorCode).toBe('meta_131047');
    });
  });

  describe('button replies, RSVP and QR (tracer steps 3–4)', () => {
    it('accept: RSVP, a QR image in the window, the hash of exactly that token', async () => {
      const { guest, wamid } = await invited();
      meta.reset();
      const inId = await replyHook(wamid, 'RSVP_ACCEPT');
      await settle(guest.id);

      const after = await reloadGuest(guest.id);
      expect(after.rsvp).toBe(GuestRsvp.ACCEPTED);
      expect(after.qrVersion).toBe(1);
      expect(after.qrTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect((await inbound(inId)).outcome).toBe(
        WhatsappInboundOutcome.APPLIED,
      );

      expect(meta.uploads).toHaveLength(1);
      expect(meta.uploads[0].subarray(1, 4).toString()).toBe('PNG');
      expect(meta.sent).toHaveLength(1);
      const image = meta.sent[0];
      expect(image.type).toBe('image');
      if (image.type !== 'image') return;
      expect(image.to).toBe(PHONE);
      const token = /\/i\/([\w-]{43})$/.exec(image.caption)?.[1];
      expect(token).toBeDefined();
      expect(hashQrToken(token!)).toBe(after.qrTokenHash);

      // Meta retries the same delivery, and the guest taps Accept again: nothing new.
      await replyHook(wamid, 'RSVP_ACCEPT', { id: inId });
      await replyHook(wamid, 'RSVP_ACCEPT');
      await settle(guest.id);
      expect(meta.sent).toHaveLength(1);
      expect(
        await messages().countBy({
          guestId: guest.id,
          kind: WhatsappMessageKind.QR,
        }),
      ).toBe(1);
    });

    it('decline revokes the QR; accepting again issues a new token', async () => {
      const { guest, wamid } = await invited();
      await replyHook(wamid, 'RSVP_ACCEPT');
      await settle(guest.id);
      const firstHash = (await reloadGuest(guest.id)).qrTokenHash;

      await replyHook(wamid, 'RSVP_DECLINE');
      let after = await reloadGuest(guest.id);
      expect(after.rsvp).toBe(GuestRsvp.DECLINED);
      expect(after.qrTokenHash).toBeNull();

      await replyHook(wamid, 'RSVP_ACCEPT');
      await settle(guest.id);
      after = await reloadGuest(guest.id);
      expect(after.rsvp).toBe(GuestRsvp.ACCEPTED);
      expect(after.qrVersion).toBe(2);
      expect(after.qrTokenHash).not.toBeNull();
      expect(after.qrTokenHash).not.toBe(firstHash);
    });

    it('decline before the QR is sent cancels it', async () => {
      const { guest, wamid } = await invited();
      // An accept whose QR is still queued (the kick has not run yet).
      await db
        .getRepository(Guest)
        .update(guest.id, { rsvp: GuestRsvp.ACCEPTED });
      const queued = await messages().save(
        messages().create({
          eventId: guest.eventId,
          guestId: guest.id,
          kind: WhatsappMessageKind.QR,
          logicalKey: `qr:${guest.id}:1`,
          qrVersion: 1,
        }),
      );
      meta.reset();
      await replyHook(wamid, 'RSVP_DECLINE');
      expect((await messages().findOneByOrFail({ id: queued.id })).state).toBe(
        WhatsappMessageState.CANCELLED,
      );
      await sender.process(queued.id); // a late worker finds nothing to send
      expect(meta.sent).toHaveLength(0);
      const after = await reloadGuest(guest.id);
      expect(after.rsvp).toBe(GuestRsvp.DECLINED);
      expect(after.qrTokenHash).toBeNull();
    });

    it('ignores replies from another number, to unknown messages, or free text', async () => {
      const { guest, wamid } = await invited();
      const wrongPhone = await replyHook(wamid, 'RSVP_ACCEPT', {
        from: '+966500000000',
      });
      const unknownContext = await replyHook('wamid.unknown', 'RSVP_ACCEPT');
      const badPayload = await replyHook(wamid, 'SOMETHING_ELSE');
      await post(
        envelope({
          messages: [
            {
              from: PHONE.slice(1),
              id: 'wamid.text.1',
              timestamp: String(Math.floor(Date.now() / 1000)),
              type: 'text',
              text: { body: 'شكراً' },
            },
          ],
        }),
      ).expect(200);

      expect((await inbound(wrongPhone)).outcome).toBe(
        WhatsappInboundOutcome.UNMATCHED,
      );
      expect((await inbound(unknownContext)).outcome).toBe(
        WhatsappInboundOutcome.UNMATCHED,
      );
      expect((await inbound(badPayload)).outcome).toBe(
        WhatsappInboundOutcome.IGNORED,
      );
      const text = await inbound('wamid.text.1');
      expect(text.outcome).toBe(WhatsappInboundOutcome.IGNORED);
      expect(text.buttonPayload).toBeNull();
      expect((await reloadGuest(guest.id)).rsvp).toBe(GuestRsvp.PENDING);
    });

    it('records a reply after the event starts and changes nothing', async () => {
      const { guest, wamid } = await invited();
      const event = await db
        .getRepository(Event)
        .findOneByOrFail({ id: guest.eventId });
      await db.getRepository(Event).update(event.id, {
        startsAt: new Date(Date.now() - 60_000),
        admissionOpensAt: new Date(Date.now() - 3_600_000),
      });
      const id = await replyHook(wamid, 'RSVP_ACCEPT');
      expect((await inbound(id)).outcome).toBe(
        WhatsappInboundOutcome.AFTER_EVENT,
      );
      expect((await reloadGuest(guest.id)).rsvp).toBe(GuestRsvp.PENDING);
    });

    it('a locked RSVP (decline that funded a replacement) does not change', async () => {
      const { guest, wamid } = await invited();
      await db.getRepository(Guest).update(guest.id, {
        rsvp: GuestRsvp.DECLINED,
        rsvpLocked: true,
      });
      const id = await replyHook(wamid, 'RSVP_ACCEPT');
      expect((await inbound(id)).outcome).toBe(WhatsappInboundOutcome.LOCKED);
      expect((await reloadGuest(guest.id)).rsvp).toBe(GuestRsvp.DECLINED);
    });
  });
});
