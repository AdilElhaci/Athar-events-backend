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
  EventPaymentStatus,
} from '../src/modules/events/entities/event.entity';
import { InvitationContent } from '../src/modules/invitations/entities/invitation-content.entity';
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

describe('Invitation approval and scheduling (e2e)', () => {
  let app: NestExpressApplication;
  let mail: CapturingMail;
  let db: DataSource;
  let redis: Redis;
  let adminAccess: string;
  let ownerAccess: string;
  let ownerId: string;

  const csrf = (req: request.Test) =>
    req.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const server = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminAccess}`);
  const asOwner = (req: request.Test) =>
    req.set('Authorization', `Bearer ${ownerAccess}`);
  const addGuest = (eventId: string, body: object) =>
    csrf(asAdmin(server().post(`/api/admin/events/${eventId}/guests`))).send(
      body,
    );
  const setList = (eventId: string, status: string) =>
    csrf(
      asAdmin(server().post(`/api/admin/events/${eventId}/list-status`)),
    ).send({ status });
  const setTemplate = (status: string) =>
    app.get(ConfigService).set('WHATSAPP_INVITATION_TEMPLATE_STATUS', status);
  const createVersion = (eventId: string, body: object) =>
    csrf(
      asAdmin(server().post(`/api/admin/events/${eventId}/invitation`)),
    ).send(body);
  const ownerView = (eventId: string) =>
    asOwner(server().get(`/api/events/${eventId}/invitation`)).expect(200);
  const approve = (eventId: string, body: object) =>
    csrf(
      asOwner(server().post(`/api/events/${eventId}/invitation/approve`)),
    ).send(body);
  const schedule = (eventId: string, sendAt: Date) =>
    csrf(asAdmin(server().post(`/api/admin/events/${eventId}/schedule`))).send({
      sendAt: sendAt.toISOString(),
    });
  const VARS = {
    eventName: 'زفاف نورة وعبدالله',
    dateText: 'الخميس 12 نوفمبر 2026، 8:00 مساءً',
    venue: 'قاعة الضيافة',
  };
  const reload = (id: string) =>
    db.getRepository(Event).findOneByOrFail({ id });

  async function createEvent(overrides: Partial<Event> = {}) {
    const startsAt = new Date(Date.now() + 30 * DAY_MS);
    return db.getRepository(Event).save(
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
        paymentStatus: EventPaymentStatus.PAID,
        admissionOpensAt: new Date(startsAt.getTime() - 3_600_000),
        admissionClosesAt: new Date(startsAt.getTime() + 3_600_000),
        ...overrides,
      }),
    );
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
      .send({ email: 'owner@example.com', name: 'سارة العتيبي' })
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
    ownerId = (
      await db
        .getRepository(User)
        .findOneByOrFail({ email: 'owner@example.com' })
    ).id;
  });

  beforeEach(async () => {
    await redis.flushdb();
    await db.query('TRUNCATE events CASCADE');
    setTemplate('PENDING');
  });

  afterAll(async () => {
    await app.close();
  });

  /** A paid event whose list is ready with one guest. */
  async function readyEvent(overrides: Partial<Event> = {}) {
    const event = await createEvent(overrides);
    await addGuest(event.id, { name: 'محمد', phone: '0501234567' }).expect(201);
    await setList(event.id, 'READY').expect(200);
    return event;
  }

  it('suggests variables and shows the template state', async () => {
    const event = await createEvent();
    const res = await asAdmin(
      server().get(`/api/admin/events/${event.id}/invitation`),
    ).expect(200);
    expect(res.body.data).toMatchObject({
      template: { name: 'athar_invitation', status: 'PENDING' },
      content: null,
      versions: 0,
      suggested: { eventName: 'زفاف نورة', venue: 'قاعة الضيافة' },
      preconditions: {
        paid: true,
        listReady: false,
        approved: false,
        templateApproved: false,
      },
    });
    expect((await ownerView(event.id)).body.data).toEqual({
      content: null,
      approvable: false,
    });
  });

  it('creates versions, and the owner approves the exact one (D-15)', async () => {
    const event = await readyEvent();
    const created = await createVersion(event.id, VARS).expect(200);
    const content = created.body.data.content;
    expect(content.version).toBe(1);
    expect(content.renderedPreview).toContain('حياك الله محمد العتيبي');
    expect(content.renderedPreview).toContain('زفاف نورة وعبدالله');
    expect((await reload(event.id)).approvalStatus).toBe(
      EventApprovalStatus.AWAITING_OWNER,
    );
    const stage = await asAdmin(
      server().get(`/api/admin/events/${event.id}`),
    ).expect(200);
    expect(stage.body.data).toMatchObject({
      stage: 'awaiting_approval',
      nextAction: 'APPROVE_INVITATION',
    });

    // Same text: no new version.
    await createVersion(event.id, VARS).expect(200);
    expect(
      await db.getRepository(InvitationContent).countBy({ eventId: event.id }),
    ).toBe(1);

    const bad = await createVersion(event.id, {
      ...VARS,
      venue: 'قاعة\nالضيافة',
    }).expect(422);
    expect(bad.body.code).toBe('invitation.variable_invalid');

    const view = (await ownerView(event.id)).body.data;
    expect(view.approvable).toBe(true);
    const outdated = await approve(event.id, {
      contentId: view.content.id,
      contentHash: 'a'.repeat(64),
    }).expect(409);
    expect(outdated.body.code).toBe('invitation.version_outdated');

    const ok = await approve(event.id, {
      contentId: view.content.id,
      contentHash: view.content.contentHash,
    }).expect(200);
    expect(ok.body.data).toMatchObject({
      approvable: false,
      content: { approvedBy: 'OWNER' },
    });
    await approve(event.id, {
      contentId: view.content.id,
      contentHash: view.content.contentHash,
    }).expect(200);
    const after = await reload(event.id);
    expect(after.approvalStatus).toBe(EventApprovalStatus.APPROVED);
    expect(after.approvedContentId).toBe(view.content.id);

    // A new version takes the approval back to the owner.
    const v2 = await createVersion(event.id, {
      ...VARS,
      venue: 'قاعة الياسمين',
    }).expect(200);
    expect(v2.body.data.content.version).toBe(2);
    const reset = await reload(event.id);
    expect(reset.approvalStatus).toBe(EventApprovalStatus.AWAITING_OWNER);
    expect(reset.approvedContentId).toBeNull();
    const stale = await approve(event.id, {
      contentId: view.content.id,
      contentHash: view.content.contentHash,
    }).expect(409);
    expect(stale.body.code).toBe('invitation.version_outdated');
  });

  it("refuses versions before payment and hides other owners' invitations", async () => {
    const unpaid = await createEvent({
      paymentStatus: EventPaymentStatus.UNPAID,
    });
    const res = await createVersion(unpaid.id, VARS).expect(422);
    expect(res.body.code).toBe('campaign.not_paid');

    const other = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: 'other@example.com',
        name: 'آخر',
        type: UserType.OWNER,
        status: UserStatus.ACTIVE,
      }),
    );
    const foreign = await createEvent({ ownerId: other.id });
    await asOwner(server().get(`/api/events/${foreign.id}/invitation`)).expect(
      404,
    );
  });

  it('lets an admin approve for the owner with a recorded reason', async () => {
    const event = await readyEvent();
    const created = await createVersion(event.id, VARS).expect(200);
    const contentId = created.body.data.content.id as string;
    await csrf(
      asAdmin(
        server().post(`/api/admin/events/${event.id}/invitation/override`),
      ),
    )
      .send({ contentId, reason: 'وافق صاحب المناسبة هاتفياً' })
      .expect(200)
      .expect((res) =>
        expect(res.body.data.content).toMatchObject({
          approvedBy: 'ADMIN',
          overrideReason: 'وافق صاحب المناسبة هاتفياً',
        }),
      );
    expect((await reload(event.id)).approvalStatus).toBe(
      EventApprovalStatus.APPROVED,
    );
    const audits = await db
      .getRepository(AdminAction)
      .findBy({ targetId: event.id, action: 'invitation.override' });
    expect(audits[0].summary).toMatchObject({
      reason: 'وافق صاحب المناسبة هاتفياً',
    });
  });

  it('schedules only when every precondition holds, then freezes edits (SP-04)', async () => {
    const event = await createEvent();
    const sendAt = new Date(Date.now() + 10 * DAY_MS);
    expect((await schedule(event.id, sendAt).expect(422)).body.code).toBe(
      'campaign.list_not_ready',
    );

    await addGuest(event.id, { name: 'محمد', phone: '0501234567' }).expect(201);
    await setList(event.id, 'READY').expect(200);
    expect((await schedule(event.id, sendAt).expect(422)).body.code).toBe(
      'campaign.not_approved',
    );

    const created = await createVersion(event.id, VARS).expect(200);
    const content = created.body.data.content;
    await approve(event.id, {
      contentId: content.id,
      contentHash: content.contentHash,
    }).expect(200);
    expect((await schedule(event.id, sendAt).expect(422)).body.code).toBe(
      'campaign.template_not_approved',
    );

    setTemplate('APPROVED');
    expect(
      (await schedule(event.id, new Date(Date.now() - 60_000)).expect(422)).body
        .code,
    ).toBe('events.send_in_past');
    expect(
      (await schedule(event.id, new Date(Date.now() + 40 * DAY_MS)).expect(422))
        .body.code,
    ).toBe('campaign.send_after_event');

    const ok = await schedule(event.id, sendAt).expect(200);
    expect(ok.body.data).toMatchObject({
      campaignStatus: 'SCHEDULED',
      stage: 'scheduled',
      nextAction: 'SCHEDULED',
    });
    expect((await reload(event.id)).scheduleVersion).toBe(1);

    // Frozen while scheduled.
    expect(
      (
        await addGuest(event.id, { name: 'خالد', phone: '0507654321' }).expect(
          409,
        )
      ).body.code,
    ).toBe('guests.list_locked');
    expect(
      (
        await createVersion(event.id, { ...VARS, venue: 'قاعة أخرى' }).expect(
          409,
        )
      ).body.code,
    ).toBe('invitation.locked');

    // Reschedule, then unschedule.
    await schedule(event.id, new Date(sendAt.getTime() + DAY_MS)).expect(200);
    expect((await reload(event.id)).scheduleVersion).toBe(2);
    const off = await csrf(
      asAdmin(server().post(`/api/admin/events/${event.id}/cancel-campaign`)),
    )
      .send({ reason: 'طلب صاحب المناسبة تأجيل الإرسال' })
      .expect(200);
    expect(off.body.data).toMatchObject({
      campaignStatus: 'NOT_SCHEDULED',
      sendAt: null,
      nextAction: 'AWAITING_SCHEDULE',
    });
    await addGuest(event.id, { name: 'خالد', phone: '0507654321' }).expect(201);
  });

  it('a material correction after approval needs a new version (D-15)', async () => {
    const event = await readyEvent();
    const created = await createVersion(event.id, VARS).expect(200);
    const content = created.body.data.content;
    await approve(event.id, {
      contentId: content.id,
      contentHash: content.contentHash,
    }).expect(200);
    await csrf(asAdmin(server().patch(`/api/admin/events/${event.id}`)))
      .send({ venueName: 'قاعة الياسمين', reason: 'تغيّرت القاعة' })
      .expect(200);
    const after = await reload(event.id);
    expect(after.approvalStatus).toBe(EventApprovalStatus.AWAITING_OWNER);
    expect(after.approvedContentId).toBeNull();
  });
});
