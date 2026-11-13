import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminAction } from '../src/modules/admin-actions/admin-action.entity';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from '../src/modules/events/entities/event.entity';
import { Guest, GuestRsvp } from '../src/modules/guests/entities/guest.entity';
import { InvitationContent } from '../src/modules/invitations/entities/invitation-content.entity';
import {
  WhatsappInbound,
  WhatsappInboundOutcome,
  WhatsappInboundType,
} from '../src/modules/invitations/entities/whatsapp-inbound.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
import { WhatsappReply } from '../src/modules/invitations/entities/whatsapp-reply.entity';
import { WhatsappWebhookService } from '../src/modules/invitations/whatsapp/whatsapp-webhook.service';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import { WhatsappSweeperJob } from '../src/modules/invitations/whatsapp/whatsapp-sweeper.job';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const DAY_MS = 86_400_000;
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

describe('Message log and resolution (e2e, SCR-25)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let meta: FakeWhatsappClient;
  let adminAccess: string;
  let ownerId: string;

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminAccess}`);
  const messages = () => db.getRepository(WhatsappMessage);
  const sweep = () => app.get(WhatsappSweeperJob).run(-1);
  const resolve = (
    id: string,
    resolution: string,
    reason = 'تحققنا مع الضيف',
  ) =>
    csrf(asAdmin(server().post(`/api/admin/messages/${id}/resolve`))).send({
      resolution,
      reason,
    });
  const list = (eventId: string, query = '') =>
    asAdmin(server().get(`/api/admin/events/${eventId}/messages${query}`));

  /** A paid, approved event in a sent campaign, with one guest and that guest's invitation intent. */
  async function sentInvitation(
    state: WhatsappMessageState,
    opts: { rsvp?: GuestRsvp; rsvpAt?: Date } = {},
  ) {
    const startsAt = new Date(Date.now() + 10 * DAY_MS);
    const event = await db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة',
        startsAt,
        venueName: 'قاعة الضيافة',
        packageName: 'فرحة',
        invitationAllowance: 5,
        extraMargin: 2,
        priceHalalas: 150_000,
        currency: 'SAR',
        status: EventStatus.ACTIVE,
        paymentStatus: EventPaymentStatus.PAID,
        listStatus: EventListStatus.READY,
        approvalStatus: EventApprovalStatus.APPROVED,
        campaignStatus: EventCampaignStatus.SENT,
        scheduleVersion: 1,
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
          eventName: 'زفاف نورة',
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
        phone: `+9665${String(++phoneSeq).padStart(8, '0')}`,
        rsvp: opts.rsvp ?? GuestRsvp.PENDING,
        rsvpAt: opts.rsvpAt ?? null,
      }),
    );
    const intent = await messages().save(
      messages().create({
        eventId: event.id,
        guestId: guest.id,
        kind: WhatsappMessageKind.INVITATION,
        logicalKey: `invitation:${guest.id}:1`,
        scheduleVersion: 1,
        state,
        lastErrorCode: state === WhatsappMessageState.FAILED ? '131026' : null,
      }),
    );
    return { event, guest, intent };
  }

  beforeAll(async () => {
    meta = new FakeWhatsappClient();
    const mail = new CapturingMail();
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
    app
      .get(ConfigService)
      .set('WHATSAPP_INVITATION_TEMPLATE_STATUS', 'APPROVED');

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

  beforeEach(() => meta.reset());

  afterAll(async () => {
    await app.close();
  });

  it('lists an event’s messages with guest details and filters', async () => {
    const { event, guest, intent } = await sentInvitation(
      WhatsappMessageState.UNKNOWN,
    );
    await messages().save(
      messages().create({
        eventId: event.id,
        guestId: guest.id,
        kind: WhatsappMessageKind.QR,
        logicalKey: `qr:${guest.id}:1`,
        qrVersion: 1,
        state: WhatsappMessageState.SENT,
      }),
    );
    const all = await list(event.id).expect(200);
    expect(all.body.data.meta.total).toBe(2);
    const open = await list(event.id, '?needsAction=true').expect(200);
    expect(open.body.data.items).toHaveLength(1);
    expect(open.body.data.items[0]).toMatchObject({
      id: intent.id,
      kind: 'INVITATION',
      state: 'UNKNOWN',
      guestName: 'محمد العتيبي',
      guestPhone: guest.phone,
      resolution: null,
    });
    const qr = await list(event.id, '?kind=QR').expect(200);
    expect(qr.body.data.items.map((m: { kind: string }) => m.kind)).toEqual([
      'QR',
    ]);
    await list('00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('marks an UNKNOWN send as sent, audited, then refuses a second resolution', async () => {
    const { intent } = await sentInvitation(WhatsappMessageState.UNKNOWN);
    const res = await resolve(intent.id, 'MARK_SENT').expect(200);
    expect(res.body.data).toMatchObject({
      resendId: null,
      message: { state: 'SENT', resolution: 'MARK_SENT' },
    });
    const audit = await db.getRepository(AdminAction).findOneByOrFail({
      action: 'message.resolve',
      targetId: intent.id,
    });
    expect(audit.summary).toMatchObject({
      from: 'UNKNOWN',
      resolution: 'MARK_SENT',
      reason: 'تحققنا مع الضيف',
    });
    expect(
      (await resolve(intent.id, 'MARK_FAILED').expect(409)).body.code,
    ).toBe('messages.not_resolvable');
    expect(meta.sent).toHaveLength(0);
  });

  it('MARK_FAILED only for UNKNOWN; a reason is required', async () => {
    const failed = await sentInvitation(WhatsappMessageState.FAILED);
    expect(
      (await resolve(failed.intent.id, 'MARK_SENT').expect(409)).body.code,
    ).toBe('messages.resolution_invalid');
    await resolve(failed.intent.id, 'RESEND', '').expect(400);
    const unknown = await sentInvitation(WhatsappMessageState.UNKNOWN);
    const res = await resolve(unknown.intent.id, 'MARK_FAILED').expect(200);
    expect(res.body.data.message.state).toBe('FAILED');
  });

  it('RESEND sends the invitation again under a new key, once', async () => {
    const { guest, intent } = await sentInvitation(WhatsappMessageState.FAILED);
    const res = await resolve(intent.id, 'RESEND').expect(200);
    const resend = await messages().findOneByOrFail({
      id: res.body.data.resendId,
    });
    expect(resend.logicalKey).toBe(`invitation:${guest.id}:1:r1`);
    expect((await messages().findOneByOrFail({ id: intent.id })).state).toBe(
      WhatsappMessageState.FAILED,
    );

    await sweep();
    expect(meta.sent.map((s) => [s.to, s.type])).toEqual([
      [guest.phone, 'template'],
    ]);
    expect((await messages().findOneByOrFail({ id: resend.id })).state).toBe(
      WhatsappMessageState.SENT,
    );
    // Now a sent invitation exists: no further resend of anything for this guest.
    const another = await messages().save(
      messages().create({
        eventId: intent.eventId,
        guestId: guest.id,
        kind: WhatsappMessageKind.INVITATION,
        logicalKey: `invitation:${guest.id}:1:r9`,
        state: WhatsappMessageState.UNKNOWN,
        scheduleVersion: 1,
      }),
    );
    expect((await resolve(another.id, 'RESEND').expect(409)).body.code).toBe(
      'messages.already_sent',
    );
  });

  it('a resend that fails again can be resent with the next suffix', async () => {
    const { guest, intent } = await sentInvitation(WhatsappMessageState.FAILED);
    const first = await resolve(intent.id, 'RESEND').expect(200);
    meta.nextOutcome = { outcome: 'FAILED', code: '131026' };
    await sweep();
    const failed = await messages().findOneByOrFail({
      id: first.body.data.resendId,
    });
    expect(failed.state).toBe(WhatsappMessageState.FAILED);
    const second = await resolve(failed.id, 'RESEND').expect(200);
    const again = await messages().findOneByOrFail({
      id: second.body.data.resendId,
    });
    expect(again.logicalKey).toBe(`invitation:${guest.id}:1:r2`);
  });

  it('refuses a resend after a reply or once the event has started', async () => {
    const replied = await sentInvitation(WhatsappMessageState.UNKNOWN, {
      rsvp: GuestRsvp.ACCEPTED,
      rsvpAt: new Date(),
    });
    expect(
      (await resolve(replied.intent.id, 'RESEND').expect(409)).body.code,
    ).toBe('messages.guest_replied');

    const started = await sentInvitation(WhatsappMessageState.FAILED);
    await db.query(
      `UPDATE events SET starts_at = now() - interval '1 minute' WHERE id = $1`,
      [started.event.id],
    );
    expect(
      (await resolve(started.intent.id, 'RESEND').expect(409)).body.code,
    ).toBe('messages.event_started');
    expect(meta.sent).toHaveLength(0);
  });

  it('resends a failed QR inside the reply window with a new version; not after it', async () => {
    const { event, guest } = await sentInvitation(WhatsappMessageState.SENT, {
      rsvp: GuestRsvp.ACCEPTED,
      rsvpAt: new Date(),
    });
    const qr = await messages().save(
      messages().create({
        eventId: event.id,
        guestId: guest.id,
        kind: WhatsappMessageKind.QR,
        logicalKey: `qr:${guest.id}:1`,
        qrVersion: 1,
        state: WhatsappMessageState.FAILED,
      }),
    );
    const res = await resolve(qr.id, 'RESEND').expect(200);
    const resend = await messages().findOneByOrFail({
      id: res.body.data.resendId,
    });
    expect(resend).toMatchObject({
      kind: WhatsappMessageKind.QR,
      qrVersion: 2,
      logicalKey: `qr:${guest.id}:2`,
    });
    await sweep();
    expect(
      meta.sent.filter((s) => s.to === guest.phone).map((s) => s.type),
    ).toEqual(['image']);
    const issued = await db
      .getRepository(Guest)
      .findOneByOrFail({ id: guest.id });
    expect(issued.qrVersion).toBe(2);

    const late = await sentInvitation(WhatsappMessageState.SENT, {
      rsvp: GuestRsvp.ACCEPTED,
      rsvpAt: new Date(Date.now() - 30 * 3_600_000),
    });
    const lateQr = await messages().save(
      messages().create({
        eventId: late.event.id,
        guestId: late.guest.id,
        kind: WhatsappMessageKind.QR,
        logicalKey: `qr:${late.guest.id}:1`,
        qrVersion: 1,
        state: WhatsappMessageState.FAILED,
      }),
    );
    expect((await resolve(lateQr.id, 'RESEND').expect(422)).body.code).toBe(
      'messages.window_closed',
    );
  });

  it('is admin-only', async () => {
    const { event, intent } = await sentInvitation(
      WhatsappMessageState.UNKNOWN,
    );
    await server().get(`/api/admin/events/${event.id}/messages`).expect(401);
    await csrf(server().post(`/api/admin/messages/${intent.id}/resolve`))
      .send({ resolution: 'MARK_SENT', reason: 'x' })
      .expect(401);
  });

  it('D-43: lists an event’s replies, newest first, with the guest and a type filter', async () => {
    const { event, guest } = await sentInvitation(WhatsappMessageState.SENT);
    const other = await sentInvitation(WhatsappMessageState.SENT);
    const inbound = db.getRepository(WhatsappInbound);
    let seq = 0;
    const save = (row: Partial<WhatsappInbound>) =>
      inbound.save(
        inbound.create({
          providerMessageId: `wamid.reply.${++seq}`,
          fromPhone: guest.phone,
          guestId: guest.id,
          eventId: event.id,
          outcome: WhatsappInboundOutcome.IGNORED,
          ...row,
        }),
      );
    await save({
      type: WhatsappInboundType.BUTTON,
      metaType: 'button',
      body: 'سأحضر',
      buttonPayload: 'RSVP_ACCEPT',
      outcome: WhatsappInboundOutcome.APPLIED,
    });
    await new Promise((r) => setTimeout(r, 10));
    await save({
      type: WhatsappInboundType.TEXT,
      metaType: 'text',
      body: 'هل الموقف متاح؟',
    });
    await save({
      type: WhatsappInboundType.TEXT,
      metaType: 'text',
      body: 'لمناسبة أخرى',
      guestId: other.guest.id,
      eventId: other.event.id,
    });

    const url = `/api/admin/events/${event.id}/replies`;
    const all = await asAdmin(server().get(url)).expect(200);
    expect(all.body.data.meta.total).toBe(2);
    expect(all.body.data.items[0]).toMatchObject({
      type: 'TEXT',
      body: 'هل الموقف متاح؟',
      guestName: 'محمد العتيبي',
      guestPhone: guest.phone,
      outcome: 'IGNORED',
    });
    expect(all.body.data.items[1]).toMatchObject({
      type: 'BUTTON',
      body: 'سأحضر',
      outcome: 'APPLIED',
    });

    const texts = await asAdmin(server().get(`${url}?type=TEXT`)).expect(200);
    expect(texts.body.data.items).toHaveLength(1);
    await asAdmin(server().get(`${url}?type=NOPE`)).expect(400);
    await server().get(url).expect(401);
    await asAdmin(
      server().get(
        '/api/admin/events/00000000-0000-4000-8000-000000000000/replies',
      ),
    ).expect(404);
  });

  describe('D-44: admin replies inside the 24 h window', () => {
    let seq = 0;
    const guestWrote = (guest: Guest, eventId: string, agoMs: number) =>
      db.getRepository(WhatsappInbound).save(
        db.getRepository(WhatsappInbound).create({
          providerMessageId: `wamid.guest.${++seq}`,
          fromPhone: guest.phone,
          guestId: guest.id,
          eventId,
          type: WhatsappInboundType.TEXT,
          metaType: 'text',
          body: 'هل الموقف متاح؟',
          outcome: WhatsappInboundOutcome.IGNORED,
          receivedAt: new Date(Date.now() - agoMs),
        }),
      );
    const send = (eventId: string, body: object) =>
      csrf(asAdmin(server().post(`/api/admin/events/${eventId}/replies`))).send(
        body,
      );
    const uuid = () => crypto.randomUUID();

    it('sends once per request id and shows in the conversation', async () => {
      const { event, guest } = await sentInvitation(WhatsappMessageState.SENT);
      await guestWrote(guest, event.id, 60 * 60_000);
      const requestId = uuid();
      const first = await send(event.id, {
        guestId: guest.id,
        requestId,
        text: '  نعم، الموقف متاح للضيوف  ',
      }).expect(200);
      expect(first.body.code).toBe('replies.sent');
      expect(first.body.data).toMatchObject({
        direction: 'OUT',
        state: 'SENT',
        body: 'نعم، الموقف متاح للضيوف',
        sentByName: 'المدير',
        guestPhone: guest.phone,
      });
      const again = await send(event.id, {
        guestId: guest.id,
        requestId,
        text: 'نعم، الموقف متاح للضيوف',
      }).expect(200);
      expect(again.body.data.id).toBe(first.body.data.id);
      const texts = meta.sent.filter((m) => m.type === 'text');
      expect(texts).toEqual([
        expect.objectContaining({
          to: guest.phone,
          body: 'نعم، الموقف متاح للضيوف',
        }),
      ]);

      const list = await asAdmin(
        server().get(`/api/admin/events/${event.id}/replies`),
      ).expect(200);
      expect(list.body.data.meta.total).toBe(2);
      expect(
        list.body.data.items.map((r: { direction: string }) => r.direction),
      ).toEqual(['OUT', 'IN']);
      expect(
        new Date(list.body.data.items[1].replyWindowClosesAt).getTime(),
      ).toBeGreaterThan(Date.now());
      const buttons = await asAdmin(
        server().get(`/api/admin/events/${event.id}/replies?type=BUTTON`),
      ).expect(200);
      expect(buttons.body.data.meta.total).toBe(0);

      // Delivery statuses reach the reply, forward only.
      const wamid = (
        await db
          .getRepository(WhatsappReply)
          .findOneByOrFail({ id: first.body.data.id })
      ).providerMessageId!;
      const hook = (status: string) =>
        app.get(WhatsappWebhookService).handle({
          object: 'whatsapp_business_account',
          entry: [
            {
              changes: [
                {
                  field: 'messages',
                  value: {
                    statuses: [
                      {
                        id: wamid,
                        status,
                        timestamp: String(Math.floor(Date.now() / 1000)),
                      },
                    ],
                  },
                },
              ],
            },
          ],
        });
      await hook('read');
      await hook('delivered');
      const row = await db
        .getRepository(WhatsappReply)
        .findOneByOrFail({ id: first.body.data.id });
      expect(row.deliveryStatus).toBe('READ');
      expect(row.readAt).not.toBeNull();
      expect(row.deliveredAt).not.toBeNull();
    });

    it('refuses outside the window, for another event’s guest, or empty text', async () => {
      const { event, guest } = await sentInvitation(WhatsappMessageState.SENT);
      const other = await sentInvitation(WhatsappMessageState.SENT);
      const body = { guestId: guest.id, requestId: uuid(), text: 'مرحباً' };
      expect((await send(event.id, body).expect(422)).body.code).toBe(
        'replies.window_closed',
      );
      await guestWrote(guest, event.id, 23 * 60 * 60_000 + 60_000);
      expect(
        (await send(event.id, { ...body, requestId: uuid() }).expect(422)).body
          .code,
      ).toBe('replies.window_closed');
      await guestWrote(other.guest, other.event.id, 60_000);
      await send(event.id, {
        guestId: other.guest.id,
        requestId: uuid(),
        text: 'مرحباً',
      }).expect(404);
      await send(other.event.id, {
        guestId: other.guest.id,
        requestId: uuid(),
        text: '   ',
      }).expect(400);
      expect(meta.sent.filter((m) => m.type === 'text')).toHaveLength(0);
      expect(
        await db.getRepository(WhatsappReply).countBy({ eventId: event.id }),
      ).toBe(0);
    });

    it('records a failure (422) and an unknown outcome (200) without retrying', async () => {
      const { event, guest } = await sentInvitation(WhatsappMessageState.SENT);
      await guestWrote(guest, event.id, 60_000);
      meta.nextOutcome = { outcome: 'FAILED', code: 'meta_131047' };
      const failed = { guestId: guest.id, requestId: uuid(), text: 'أولى' };
      expect((await send(event.id, failed).expect(422)).body.code).toBe(
        'replies.window_closed',
      );
      // The same submit again reports the same failure and sends nothing.
      expect((await send(event.id, failed).expect(422)).body.code).toBe(
        'replies.window_closed',
      );
      expect(meta.sent.filter((m) => m.type === 'text')).toHaveLength(0);
      meta.nextOutcome = { outcome: 'UNKNOWN', code: 'ETIMEDOUT' };
      const unknown = await send(event.id, {
        guestId: guest.id,
        requestId: uuid(),
        text: 'ثانية',
      }).expect(200);
      expect(unknown.body.code).toBe('replies.unknown');
      expect(unknown.body.data.state).toBe('UNKNOWN');
      const rows = await db
        .getRepository(WhatsappReply)
        .find({ where: { eventId: event.id }, order: { createdAt: 'ASC' } });
      expect(rows.map((r) => [r.state, r.errorCode])).toEqual([
        ['FAILED', 'meta_131047'],
        ['UNKNOWN', 'ETIMEDOUT'],
      ]);
      const actions = await db
        .getRepository(AdminAction)
        .findBy({ action: 'reply.send' });
      expect(actions.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(actions)).not.toContain('أولى');
    });
  });
});
