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
import {
  Guest,
  GuestAllocationStatus,
  GuestKind,
  GuestRsvp,
} from '../src/modules/guests/entities/guest.entity';
import { InvitationContent } from '../src/modules/invitations/entities/invitation-content.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
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
const MINUTE = 60_000;
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

describe('Replacements (e2e, SP-04 / D-16)', () => {
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
  const send = (eventId: string, body: object) =>
    csrf(
      asAdmin(server().post(`/api/admin/events/${eventId}/replacements`)),
    ).send(body);
  const view = (eventId: string) =>
    asAdmin(server().get(`/api/admin/events/${eventId}/replacements`)).expect(
      200,
    );
  const guests = () => db.getRepository(Guest);
  const reload = (id: string) => guests().findOneByOrFail({ id });

  /**
   * A paid event whose campaign was sent: initial guests A and B declined (A first), C accepted;
   * reserves R1, R2, R3 in list order. Margin 2 unless given.
   */
  async function campaign(
    opts: { margin?: number; campaignStatus?: EventCampaignStatus } = {},
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
        extraMargin: opts.margin ?? 2,
        priceHalalas: 150_000,
        currency: 'SAR',
        status: EventStatus.ACTIVE,
        paymentStatus: EventPaymentStatus.PAID,
        listStatus: EventListStatus.READY,
        approvalStatus: EventApprovalStatus.APPROVED,
        campaignStatus: opts.campaignStatus ?? EventCampaignStatus.SENT,
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

    const make = (name: string, kind: GuestKind, extra: Partial<Guest> = {}) =>
      guests().save(
        guests().create({
          eventId: event.id,
          name,
          phone: `+9665${String(++phoneSeq).padStart(8, '0')}`,
          kind,
          allocationStatus:
            kind === GuestKind.INITIAL
              ? GuestAllocationStatus.ALLOCATED
              : GuestAllocationStatus.NOT_ALLOCATED,
          ...extra,
        }),
      );
    const now = Date.now();
    const a = await make('أ', GuestKind.INITIAL, {
      rsvp: GuestRsvp.DECLINED,
      rsvpAt: new Date(now - 10 * MINUTE),
    });
    const b = await make('ب', GuestKind.INITIAL, {
      rsvp: GuestRsvp.DECLINED,
      rsvpAt: new Date(now - 5 * MINUTE),
    });
    const c = await make('ج', GuestKind.INITIAL, {
      rsvp: GuestRsvp.ACCEPTED,
      rsvpAt: new Date(now - 5 * MINUTE),
    });
    const r1 = await make('احتياط ١', GuestKind.RESERVE);
    const r2 = await make('احتياط ٢', GuestKind.RESERVE);
    const r3 = await make('احتياط ٣', GuestKind.RESERVE);
    return { event, a, b, c, r1, r2, r3 };
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

  beforeEach(async () => {
    meta.reset();
    // Each test sees only its own queued invitations.
    await db.query(
      `UPDATE whatsapp_messages SET state = 'CANCELLED' WHERE state = 'QUEUED'`,
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('shows extras, eligible declines (oldest first) and reserves', async () => {
    const { event, a, b, r1, r2, r3 } = await campaign();
    const res = await view(event.id);
    expect(res.body.data).toMatchObject({
      extras: { cap: 2, used: 0, available: 2 },
      blockedReason: null,
      sent: [],
    });
    expect(
      res.body.data.eligibleDeclines.map((g: { id: string }) => g.id),
    ).toEqual([a.id, b.id]);
    expect(res.body.data.reserves.map((g: { id: string }) => g.id)).toEqual([
      r1.id,
      r2.id,
      r3.id,
    ]);
  });

  it('sends one replacement for the oldest decline, locks it, and invites at once', async () => {
    const { event, a, b, r1 } = await campaign();
    const res = await send(event.id, { count: 1 }).expect(200);
    expect(res.body.data.extras).toEqual({ cap: 2, used: 1, available: 1 });
    expect(res.body.data.allocated).toHaveLength(1);
    expect(res.body.data.allocated[0]).toMatchObject({
      id: r1.id,
      allocationStatus: 'ALLOCATED',
      replacementForGuestId: a.id,
    });
    expect((await reload(a.id)).rsvpLocked).toBe(true);
    expect((await reload(b.id)).rsvpLocked).toBe(false);
    const intent = await db
      .getRepository(WhatsappMessage)
      .findOneByOrFail({ guestId: r1.id });
    expect(intent).toMatchObject({
      kind: WhatsappMessageKind.INVITATION,
      state: WhatsappMessageState.QUEUED,
      logicalKey: `invitation:${r1.id}:1`,
    });
    await app.get(WhatsappSweeperJob).run(-1);
    expect(meta.sent.map((s) => [s.to, s.type])).toEqual([
      [r1.phone, 'template'],
    ]);
    const audit = await db.getRepository(AdminAction).findOneByOrFail({
      action: 'replacements.send',
      targetId: event.id,
    });
    expect(audit.summary).toMatchObject({
      count: 1,
      pairs: [{ reserve: r1.id, decline: a.id }],
    });
    const after = await view(event.id);
    expect(after.body.data.sent).toEqual([
      expect.objectContaining({ id: r1.id, replacedGuestName: 'أ' }),
    ]);
  });

  it("a replacement's own decline unlocks another; never beyond the margin", async () => {
    const { event, r1, r2 } = await campaign();
    await send(event.id, { count: 1 }).expect(200); // r1 for a
    await guests().update(r1.id, {
      rsvp: GuestRsvp.DECLINED,
      rsvpAt: new Date(),
    });
    const before = await view(event.id);
    expect(before.body.data.eligibleDeclines).toHaveLength(2); // b and r1
    expect((await send(event.id, { count: 2 }).expect(422)).body.code).toBe(
      'replacements.margin_exhausted',
    );
    await send(event.id, { count: 1 }).expect(200); // r2 for b
    expect((await reload(r2.id)).allocationStatus).toBe(
      GuestAllocationStatus.ALLOCATED,
    );
    expect((await send(event.id, { count: 1 }).expect(422)).body.code).toBe(
      'replacements.margin_exhausted',
    );
    expect((await view(event.id)).body.data.extras).toEqual({
      cap: 2,
      used: 2,
      available: 0,
    });
  });

  it('sends the chosen reserve guests; refuses a guest who is not a free reserve', async () => {
    const { event, a, c, r3 } = await campaign();
    expect(
      (await send(event.id, { guestIds: [c.id] }).expect(422)).body.code,
    ).toBe('replacements.guest_invalid');
    const res = await send(event.id, { guestIds: [r3.id] }).expect(200);
    expect(res.body.data.allocated[0]).toMatchObject({
      id: r3.id,
      replacementForGuestId: a.id,
    });
    expect(
      (await send(event.id, { guestIds: [r3.id] }).expect(422)).body.code,
    ).toBe('replacements.guest_invalid');
  });

  it('refuses without declines, without reserves, or with a bad request', async () => {
    const { event, a, b, r1, r2, r3 } = await campaign({ margin: 5 });
    expect((await send(event.id, { count: 3 }).expect(422)).body.code).toBe(
      'replacements.no_declines_available',
    );
    await guests().update([r1.id, r2.id, r3.id], { deletedAt: new Date() });
    expect((await send(event.id, { count: 1 }).expect(422)).body.code).toBe(
      'replacements.no_reserves',
    );
    expect(
      (await send(event.id, { count: 1, guestIds: [r1.id] }).expect(422)).body
        .code,
    ).toBe('replacements.count_or_guests');
    expect((await send(event.id, {}).expect(422)).body.code).toBe(
      'replacements.count_or_guests',
    );
    expect((await reload(a.id)).rsvpLocked).toBe(false);
    expect((await reload(b.id)).rsvpLocked).toBe(false);
  });

  it('only after the campaign started and before the event starts', async () => {
    const early = await campaign({
      campaignStatus: EventCampaignStatus.SCHEDULED,
    });
    expect(
      (await send(early.event.id, { count: 1 }).expect(409)).body.code,
    ).toBe('replacements.campaign_not_started');
    expect((await view(early.event.id)).body.data.blockedReason).toBe(
      'replacements.campaign_not_started',
    );
    const late = await campaign();
    await db.query(
      `UPDATE events SET starts_at = now() - interval '1 minute' WHERE id = $1`,
      [late.event.id],
    );
    expect(
      (await send(late.event.id, { count: 1 }).expect(409)).body.code,
    ).toBe('replacements.event_started');
  });

  it('two admins at once never exceed the margin', async () => {
    const { event } = await campaign({ margin: 1 });
    const results = await Promise.all([
      send(event.id, { count: 1 }),
      send(event.id, { count: 1 }),
      send(event.id, { count: 1 }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 422, 422]);
    const [{ n }] = await db.query<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM guests WHERE event_id = $1 AND replacement_for_guest_id IS NOT NULL`,
      [event.id],
    );
    expect(n).toBe(1);
  });

  it('is admin-only', async () => {
    const { event } = await campaign();
    await server()
      .get(`/api/admin/events/${event.id}/replacements`)
      .expect(401);
    await csrf(server().post(`/api/admin/events/${event.id}/replacements`))
      .send({ count: 1 })
      .expect(401);
  });
});
