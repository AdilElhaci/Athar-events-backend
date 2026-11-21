import { createHmac } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminProvisioningService } from '../src/modules/auth/services/admin-provisioning.service';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  deriveQrToken,
  hashQrToken,
  newQrToken,
} from '../src/modules/checkin/qr-token';
import {
  Event,
  EventCampaignStatus,
  EventPaymentStatus,
} from '../src/modules/events/entities/event.entity';
import {
  Guest,
  GuestAllocationStatus,
  GuestRsvp,
} from '../src/modules/guests/entities/guest.entity';
import { InvitationContent } from '../src/modules/invitations/entities/invitation-content.entity';
import {
  RsvpReviewDecision,
  WhatsappInbound,
  WhatsappInboundOutcome,
} from '../src/modules/invitations/entities/whatsapp-inbound.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
import { JourneyService } from '../src/modules/invitations/journey/journey.service';
import { JourneyTemplatesService } from '../src/modules/invitations/journey/journey-templates.service';
import {
  journeyTimeline,
  JourneyStep,
} from '../src/modules/invitations/journey/journey-schedule';
import { FakeWhatsappClient } from '../src/modules/invitations/whatsapp/testing/fake-whatsapp.client';
import { WhatsappClient } from '../src/modules/invitations/whatsapp/whatsapp.client';
import { WhatsappSenderService } from '../src/modules/invitations/whatsapp/whatsapp-sender.service';
import { MailService } from '../src/modules/mail/mail.service';
import type { MailMessage } from '../src/modules/mail/mail.templates';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const APP_SECRET = process.env.WHATSAPP_APP_SECRET!;
const QR_SECRET = process.env.QR_TOKEN_SECRET!;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE = 60_000;
const TEMPLATES = [
  'athar_followup',
  'athar_followup_final',
  'athar_reminder',
  'athar_reminder_final',
  'athar_thanks',
  'athar_confirmation',
];
let phoneSeq = 0;
let inboundSeq = 0;

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

describe('Guest journeys (e2e, SP-07)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let meta: FakeWhatsappClient;
  let sender: WhatsappSenderService;
  let journeys: JourneyService;
  let adminAccess: string;
  let ownerId: string;

  const server = () => request(app.getHttpServer());
  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminAccess}`);
  const messages = () => db.getRepository(WhatsappMessage);
  const reloadGuest = (id: string) =>
    db.getRepository(Guest).findOneByOrFail({ id });
  const inbound = (id: string) =>
    db
      .getRepository(WhatsappInbound)
      .findOneByOrFail({ providerMessageId: id });

  const replyHook = async (
    contextId: string,
    payload: string,
    from: string,
  ) => {
    const id = `wamid.in.j${++inboundSeq}`;
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
                    type: 'button',
                    context: { from: '15556393093', id: contextId },
                    button: { payload, text: 'x' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await server()
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set(
        'X-Hub-Signature-256',
        `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`,
      )
      .send(raw)
      .expect(200);
    return id;
  };

  async function settle(guestId: string) {
    for (let i = 0; i < 50; i++) {
      const open = await messages().countBy([
        { guestId, state: WhatsappMessageState.QUEUED },
        { guestId, state: WhatsappMessageState.SENDING },
      ]);
      if (!open) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('intents did not settle');
  }

  /**
   * A 21-day journey event 30 days ahead, invitations "sent" now, campaign running. Every step is
   * still in the future; tests call `createDue(dueAt + 1 min)` for the step they check.
   */
  async function journeyEvent(
    opts: { extraMargin?: number; rsvpClosesAt?: Date } = {},
  ) {
    const startsAt = new Date(Date.now() + 30 * DAY_MS);
    const sendAt = new Date(Date.now() - MINUTE);
    const event = await db.getRepository(Event).save(
      db.getRepository(Event).create({
        ownerId,
        name: 'زفاف نورة وعبدالله',
        startsAt,
        venueName: 'قاعة الضيافة',
        venueMapUrl: 'https://maps.app.goo.gl/example',
        packageName: 'فرحة',
        invitationAllowance: 10,
        extraMargin: opts.extraMargin ?? 2,
        priceHalalas: 150_000,
        currency: 'SAR',
        paymentStatus: EventPaymentStatus.PAID,
        admissionOpensAt: new Date(startsAt.getTime() - HOUR_MS),
        admissionClosesAt: new Date(startsAt.getTime() + HOUR_MS),
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
          dateText: 'الخميس',
          venue: 'قاعة الضيافة',
        },
        renderedPreview: '-',
        contentHash: '0'.repeat(64),
        createdByUserId: ownerId,
        approvedAt: new Date(),
        approvedByUserId: ownerId,
      }),
    );
    await db.getRepository(Event).update(event.id, {
      approvedContentId: content.id,
      journey: 21,
      sendAt,
      rsvpClosesAt:
        opts.rsvpClosesAt ?? new Date(startsAt.getTime() - 2 * DAY_MS),
      campaignStatus: EventCampaignStatus.SENDING,
    });
    const reloaded = await db
      .getRepository(Event)
      .findOneByOrFail({ id: event.id });
    const timeline = journeyTimeline({
      journey: 21,
      startsAt,
      timeZone: reloaded.timezone,
      sendAt,
    });
    return { event: reloaded, timeline };
  }

  /** A guest whose invitation was sent `sentAgoMs` ago (default 1 day before follow-up 1). */
  async function invitedGuest(
    eventId: string,
    sentAt: Date = new Date(Date.now() - DAY_MS),
  ) {
    const phone = `+9665${String(10000000 + ++phoneSeq).padStart(8, '0')}`;
    const guest = await db.getRepository(Guest).save(
      db.getRepository(Guest).create({
        eventId,
        name: 'محمد العتيبي',
        phone,
        allocationStatus: GuestAllocationStatus.ALLOCATED,
        allocatedAt: sentAt,
      }),
    );
    const wamid = `wamid.inv.${phoneSeq}`;
    await messages().save(
      messages().create({
        eventId,
        guestId: guest.id,
        kind: WhatsappMessageKind.INVITATION,
        logicalKey: `invitation:${guest.id}:1`,
        state: WhatsappMessageState.SENT,
        providerMessageId: wamid,
        sentAt,
      }),
    );
    return { guest, wamid, phone };
  }

  /** Accept by WhatsApp: the confirmation with the QR goes out. */
  async function accepted(eventId: string) {
    const g = await invitedGuest(eventId);
    await replyHook(g.wamid, 'RSVP_ACCEPT', g.phone);
    await settle(g.guest.id);
    return g;
  }

  const due = (timeline: Record<JourneyStep, Date>, step: JourneyStep) =>
    new Date(timeline[step].getTime() + MINUTE);
  const ofKind = (eventId: string, kind: WhatsappMessageKind) =>
    messages().findBy({ eventId, kind });
  const runDue = async (at: Date) => {
    const created = await journeys.createDue(at);
    await sender.processQueued(50, 0);
    return created;
  };

  /** Every journey template approved at Meta (the fake WABA). */
  const approveTemplates = () => {
    meta.templates = TEMPLATES.map((name, i) => ({
      id: String(800000 + i),
      name,
      language: 'ar',
      category: 'UTILITY',
      status: 'APPROVED',
      rejectedReason: null,
      body: null,
      buttons: [],
    }));
  };

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
    sender = app.get(WhatsappSenderService);
    journeys = app.get(JourneyService);

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

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Each test sees only its own journey: earlier events stop running.
    await db.query(`UPDATE events SET campaign_status = 'CANCELLED'`);
    meta.reset();
    approveTemplates();
    app.get(JourneyTemplatesService).reset();
  });

  it('follow-ups go once to guests with no reply, never to a late guest (AC-J-3, AC-J-10)', async () => {
    const { event, timeline } = await journeyEvent();
    const pending = await invitedGuest(event.id);
    const replied = await accepted(event.id);
    // Invited less than 24 h before follow-up 1 (a late replacement).
    const late = await invitedGuest(
      event.id,
      new Date(timeline.FOLLOW_UP_1.getTime() - 2 * HOUR_MS),
    );
    meta.reset();
    approveTemplates();

    expect(await runDue(due(timeline, 'FOLLOW_UP_1'))).toBe(1);
    expect(await journeys.createDue(due(timeline, 'FOLLOW_UP_1'))).toBe(0);
    const [followUp] = await ofKind(event.id, WhatsappMessageKind.FOLLOW_UP_1);
    expect(followUp).toMatchObject({
      guestId: pending.guest.id,
      state: WhatsappMessageState.SENT,
    });
    expect(followUp.scheduledFor).toEqual(timeline.FOLLOW_UP_1);
    expect(meta.sent).toEqual([
      expect.objectContaining({
        type: 'template',
        to: pending.phone,
        template: expect.objectContaining({
          name: 'athar_followup',
          quickReplyPayloads: ['RSVP_ACCEPT', 'RSVP_DECLINE'],
        }),
      }),
    ]);
    expect(replied.guest.id).not.toBe(late.guest.id);

    // Follow-up 2 to the same guest; after it, nothing more is created for no reply.
    expect(await runDue(due(timeline, 'FOLLOW_UP_2'))).toBe(2); // the late guest is now old enough
    expect(await journeys.createDue(due(timeline, 'REMINDER_1'))).toBe(1); // only the accepted guest
    const reminders = await ofKind(event.id, WhatsappMessageKind.REMINDER_1);
    expect(reminders.map((m) => m.guestId)).toEqual([replied.guest.id]);
  });

  it('a reply to a follow-up counts like a reply to the invitation (AC-J-1)', async () => {
    const { event, timeline } = await journeyEvent();
    const g = await invitedGuest(event.id);
    await runDue(due(timeline, 'FOLLOW_UP_1'));
    const [followUp] = await ofKind(event.id, WhatsappMessageKind.FOLLOW_UP_1);
    const id = await replyHook(
      followUp.providerMessageId!,
      'RSVP_ACCEPT',
      g.phone,
    );
    expect((await inbound(id)).outcome).toBe(WhatsappInboundOutcome.APPLIED);
    await settle(g.guest.id);
    const image = meta.sent.find((m) => m.type === 'image');
    expect(image).toMatchObject({ to: g.phone });
    expect(image?.type === 'image' && image.caption).toContain(
      'https://maps.app.goo.gl/example',
    );
    // No more follow-ups for an accepted guest.
    expect(await journeys.createDue(due(timeline, 'FOLLOW_UP_2'))).toBe(0);
  });

  it('a step found after its grace period is never sent (AC-J-9)', async () => {
    const { event, timeline } = await journeyEvent();
    await invitedGuest(event.id);
    const late = new Date(timeline.FOLLOW_UP_1.getTime() + 3 * HOUR_MS);
    expect(await runDue(late)).toBe(0);
    expect(await ofKind(event.id, WhatsappMessageKind.FOLLOW_UP_1)).toEqual([]);
  });

  it('a follow-up due after the RSVP close is not created', async () => {
    const { event, timeline } = await journeyEvent({
      rsvpClosesAt: new Date(Date.now() + 5 * DAY_MS), // before follow-up 2 (+7 days)
    });
    await invitedGuest(event.id);
    expect(await runDue(due(timeline, 'FOLLOW_UP_2'))).toBe(0);
  });

  it('reminders carry the same QR, and skip a guest who accepted under 24 h before (AC-J-4, D-55)', async () => {
    const { event, timeline } = await journeyEvent();
    const early = await accepted(event.id);
    const before = await reloadGuest(early.guest.id);
    // The confirmation token is derived: the same secret, guest and version give it again.
    expect(before.qrTokenHash).toBe(
      hashQrToken(deriveQrToken(QR_SECRET, before.id, before.qrVersion)),
    );
    const recent = await accepted(event.id);
    await db.getRepository(Guest).update(recent.guest.id, {
      rsvpAt: new Date(timeline.REMINDER_1.getTime() - 3 * HOUR_MS),
    });
    meta.reset();
    approveTemplates();

    expect(await runDue(due(timeline, 'REMINDER_1'))).toBe(1);
    expect(meta.sent).toHaveLength(1);
    expect(meta.sent[0]).toMatchObject({
      to: early.phone,
      template: {
        name: 'athar_reminder',
        headerImageMediaId: expect.any(String),
        bodyParameters: expect.arrayContaining([
          'زفاف نورة وعبدالله',
          'https://maps.app.goo.gl/example',
        ]),
      },
    });
    const after = await reloadGuest(early.guest.id);
    expect(after.qrVersion).toBe(before.qrVersion);
    expect(after.qrTokenHash).toBe(before.qrTokenHash);
  });

  it('a QR issued before D-55 is reissued with the reminder', async () => {
    const { event, timeline } = await journeyEvent();
    const g = await accepted(event.id);
    const legacy = hashQrToken(newQrToken());
    await db.getRepository(Guest).update(g.guest.id, { qrTokenHash: legacy });
    const before = await reloadGuest(g.guest.id);
    await runDue(due(timeline, 'REMINDER_1'));
    const after = await reloadGuest(g.guest.id);
    expect(after.qrVersion).toBe(before.qrVersion + 1);
    expect(after.qrTokenHash).toBe(
      hashQrToken(deriveQrToken(QR_SECRET, g.guest.id, after.qrVersion)),
    );
  });

  it('a decline sends the apology once and cancels queued reminders (AC-J-7)', async () => {
    const { event } = await journeyEvent();
    const g = await accepted(event.id);
    await messages().save(
      messages().create({
        eventId: event.id,
        guestId: g.guest.id,
        kind: WhatsappMessageKind.REMINDER_1,
        logicalKey: `reminder_1:${g.guest.id}:0`,
        scheduledFor: new Date(),
      }),
    );
    meta.reset();
    await replyHook(g.wamid, 'RSVP_DECLINE', g.phone);
    await settle(g.guest.id);
    await replyHook(g.wamid, 'RSVP_DECLINE', g.phone);
    await settle(g.guest.id);

    const texts = meta.sent.filter((m) => m.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].type === 'text' && texts[0].body).toContain('نقدّر ظروفكم');
    const guest = await reloadGuest(g.guest.id);
    expect(guest.rsvp).toBe(GuestRsvp.DECLINED);
    expect(guest.qrTokenHash).toBeNull();
    const [reminder] = await ofKind(event.id, WhatsappMessageKind.REMINDER_1);
    expect(reminder).toMatchObject({
      state: WhatsappMessageState.CANCELLED,
      lastErrorCode: 'declined',
    });
  });

  it('decline then accept before the close: a new QR version (AC-J-2)', async () => {
    const { event } = await journeyEvent();
    const g = await accepted(event.id);
    const first = await reloadGuest(g.guest.id);
    await replyHook(g.wamid, 'RSVP_DECLINE', g.phone);
    await settle(g.guest.id);
    await replyHook(g.wamid, 'RSVP_ACCEPT', g.phone);
    await settle(g.guest.id);
    const again = await reloadGuest(g.guest.id);
    expect(again.rsvp).toBe(GuestRsvp.ACCEPTED);
    expect(again.qrVersion).toBe(first.qrVersion + 1);
    expect(again.qrTokenHash).not.toBe(first.qrTokenHash);
  });

  it('an accept after the close waits for an admin, who accepts or dismisses (AC-J-8)', async () => {
    const { event } = await journeyEvent();
    const a = await invitedGuest(event.id);
    const b = await invitedGuest(event.id);
    await db
      .getRepository(Event)
      .update(event.id, { rsvpClosesAt: new Date(Date.now() - MINUTE) });

    const idA = await replyHook(a.wamid, 'RSVP_ACCEPT', a.phone);
    await replyHook(b.wamid, 'RSVP_ACCEPT', b.phone);
    expect((await inbound(idA)).outcome).toBe(WhatsappInboundOutcome.REVIEW);
    expect((await reloadGuest(a.guest.id)).rsvp).toBe(GuestRsvp.PENDING);
    expect(meta.sent).toEqual([]);

    const list = await asAdmin(
      server().get(`/api/admin/events/${event.id}/rsvp-reviews`),
    ).expect(200);
    expect(list.body.data.items).toHaveLength(2);
    expect(list.body.data.items[0]).toMatchObject({ reason: 'CLOSED' });
    const view = await asAdmin(
      server().get(`/api/admin/events/${event.id}/invitation`),
    ).expect(200);
    expect(view.body.data.journey.pendingReviews).toBe(2);

    const itemA = list.body.data.items.find(
      (i: { guestId: string }) => i.guestId === a.guest.id,
    );
    const itemB = list.body.data.items.find(
      (i: { guestId: string }) => i.guestId === b.guest.id,
    );
    const decided = await csrf(
      asAdmin(
        server().post(
          `/api/admin/events/${event.id}/rsvp-reviews/${itemA.inboundId}`,
        ),
      ),
    )
      .send({ decision: 'ACCEPT' })
      .expect(200);
    expect(decided.body.data.items).toHaveLength(1);
    await sender.processQueued(50, 0);
    await settle(a.guest.id);
    expect((await reloadGuest(a.guest.id)).rsvp).toBe(GuestRsvp.ACCEPTED);
    expect(meta.sent).toEqual([
      expect.objectContaining({ type: 'image', to: a.phone }),
    ]);

    await csrf(
      asAdmin(
        server().post(
          `/api/admin/events/${event.id}/rsvp-reviews/${itemB.inboundId}`,
        ),
      ),
    )
      .send({ decision: 'DISMISS' })
      .expect(200);
    expect((await reloadGuest(b.guest.id)).rsvp).toBe(GuestRsvp.PENDING);
    const decidedB = await db
      .getRepository(WhatsappInbound)
      .findOneByOrFail({ id: itemB.inboundId });
    expect(decidedB.reviewDecision).toBe(RsvpReviewDecision.DISMISSED);
    // Decided once.
    await csrf(
      asAdmin(
        server().post(
          `/api/admin/events/${event.id}/rsvp-reviews/${itemB.inboundId}`,
        ),
      ),
    )
      .send({ decision: 'ACCEPT' })
      .expect(404);
  });

  it('the thank-you goes the day after, to admitted guests only (AC-J-6)', async () => {
    const { event, timeline } = await journeyEvent();
    const came = await accepted(event.id);
    await accepted(event.id); // accepted, never scanned
    await db
      .getRepository(Guest)
      .update(came.guest.id, { checkedInAt: new Date() });
    meta.reset();
    approveTemplates();
    expect(await runDue(due(timeline, 'THANK_YOU'))).toBe(1);
    expect(meta.sent).toEqual([
      expect.objectContaining({
        to: came.phone,
        template: expect.objectContaining({
          name: 'athar_thanks',
          bodyParameters: ['زفاف نورة وعبدالله'],
        }),
      }),
    ]);
  });

  it('a step whose template is not approved at Meta waits', async () => {
    const { event, timeline } = await journeyEvent();
    await invitedGuest(event.id);
    meta.templates = meta.templates.filter((t) => t.name !== 'athar_followup');
    app.get(JourneyTemplatesService).reset();
    expect(await runDue(due(timeline, 'FOLLOW_UP_1'))).toBe(0);
  });
});
