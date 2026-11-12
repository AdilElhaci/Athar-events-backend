import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
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
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
} from '../src/modules/events/entities/event.entity';
import { GuestImport } from '../src/modules/guests/entities/guest-import.entity';
import {
  Guest,
  GuestAllocationStatus,
  GuestKind,
  GuestRsvp,
} from '../src/modules/guests/entities/guest.entity';
import {
  WhatsappDeliveryStatus,
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../src/modules/invitations/entities/whatsapp-message.entity';
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

type Cell = string | number | { formula: string };

async function sheet(
  rows: Cell[][],
  header = ['الاسم', 'الجوال', 'النوع', 'ملاحظة'],
) {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('الضيوف');
  ws.addRow(header);
  for (const row of rows) ws.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** 05XXXXXXXX with a running suffix. */
const phone = (n: number) => `05${String(10_000_000 + n).padStart(8, '0')}`;

describe('Guests and import (e2e)', () => {
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
  const upload = (eventId: string, file: Buffer, name = 'guests.xlsx') =>
    csrf(
      asAdmin(server().post(`/api/admin/events/${eventId}/guest-imports`)),
    ).attach('file', file, name);
  const apply = (eventId: string, importId: string) =>
    csrf(
      asAdmin(
        server().post(
          `/api/admin/events/${eventId}/guest-imports/${importId}/apply`,
        ),
      ),
    );
  const setList = (eventId: string, status: string) =>
    csrf(
      asAdmin(server().post(`/api/admin/events/${eventId}/list-status`)),
    ).send({ status });
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
  });

  afterAll(async () => {
    await app.close();
  });

  it('keeps guest endpoints for admins and owners apart', async () => {
    const event = await createEvent();
    await asOwner(server().get(`/api/admin/events/${event.id}/guests`)).expect(
      403,
    );
    await asAdmin(server().get(`/api/events/${event.id}/guests`)).expect(403);
  });

  it('adds guests manually within the allowance and margin (AC-04-3)', async () => {
    const event = await createEvent({ invitationAllowance: 2, extraMargin: 1 });
    const first = await addGuest(event.id, {
      name: '  محمد   العتيبي ',
      phone: '٠٥٠١٢٣٤٥٦٧',
    }).expect(201);
    expect(first.body.data).toMatchObject({
      name: 'محمد العتيبي',
      phone: '+966501234567',
      kind: 'INITIAL',
      source: 'MANUAL',
    });
    expect((await reload(event.id)).listStatus).toBe(
      EventListStatus.IN_PROGRESS,
    );

    const dup = await addGuest(event.id, {
      name: 'خالد',
      phone: '+966 50 123 4567',
    }).expect(409);
    expect(dup.body.code).toBe('guests.phone_duplicate');

    await addGuest(event.id, { name: 'خالد', phone: phone(2) }).expect(201);
    const full = await addGuest(event.id, {
      name: 'فهد',
      phone: phone(3),
    }).expect(422);
    expect(full.body.code).toBe('guests.allowance_exceeded');
    await addGuest(event.id, {
      name: 'فهد',
      phone: phone(3),
      kind: 'RESERVE',
    }).expect(201);
    const reserveFull = await addGuest(event.id, {
      name: 'سعد',
      phone: phone(4),
      kind: 'RESERVE',
    }).expect(422);
    expect(reserveFull.body.code).toBe('guests.reserve_exceeded');

    const invalid = await addGuest(event.id, {
      name: 'سعد',
      phone: '+201001234567',
    }).expect(422);
    expect(invalid.body.code).toBe('imports.row.phone_invalid');

    const list = await asAdmin(
      server().get(`/api/admin/events/${event.id}/guests?search=4567`),
    ).expect(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.counts).toEqual({
      initial: 2,
      reserve: 1,
      allowance: 2,
      extraMargin: 1,
    });

    const actions = await db
      .getRepository(AdminAction)
      .findBy({ targetId: event.id, action: 'guests.create' });
    expect(actions).toHaveLength(3);
    expect(JSON.stringify(actions)).not.toContain('5012');
  });

  it('refuses guests before payment and after scheduling', async () => {
    const unpaid = await createEvent({
      paymentStatus: EventPaymentStatus.UNPAID,
    });
    const res = await addGuest(unpaid.id, {
      name: 'محمد',
      phone: phone(1),
    }).expect(422);
    expect(res.body.code).toBe('guests.event_unpaid');

    const scheduled = await createEvent({
      campaignStatus: EventCampaignStatus.SCHEDULED,
      sendAt: new Date(Date.now() + DAY_MS),
    });
    const locked = await addGuest(scheduled.id, {
      name: 'محمد',
      phone: phone(1),
    }).expect(409);
    expect(locked.body.code).toBe('guests.list_locked');
  });

  it('edits and deletes, and a deleted number can be added again', async () => {
    const event = await createEvent();
    const { body } = await addGuest(event.id, {
      name: 'محمد',
      phone: phone(1),
    }).expect(201);
    const id = body.data.id as string;
    const edited = await csrf(
      asAdmin(server().patch(`/api/admin/events/${event.id}/guests/${id}`)),
    )
      .send({ name: 'محمد سعد', kind: 'RESERVE' })
      .expect(200);
    expect(edited.body.data).toMatchObject({
      name: 'محمد سعد',
      kind: 'RESERVE',
    });
    await csrf(
      asAdmin(server().delete(`/api/admin/events/${event.id}/guests/${id}`)),
    ).expect(200);
    await addGuest(event.id, { name: 'محمد', phone: phone(1) }).expect(201);
  });

  it('previews 300 valid, 5 invalid, 3 duplicate rows and applies 300 (TC-IMP-01, TC-IMP-04)', async () => {
    const event = await createEvent({
      invitationAllowance: 400,
      extraMargin: 20,
    });
    const rows: Cell[][] = [];
    for (let i = 0; i < 300; i++) rows.push([`ضيف ${i}`, phone(i)]);
    for (let i = 0; i < 5; i++) rows.push([`خطأ ${i}`, '12345']);
    for (let i = 0; i < 3; i++) rows.push([`مكرر ${i}`, phone(i)]);
    rows.push(['مثال: محمد العتيبي', '0500000000', 'أساسي']); // template example: skipped

    const preview = await upload(event.id, await sheet(rows)).expect(200);
    const data = preview.body.data;
    expect(data.counts).toMatchObject({
      total: 308,
      valid: 300,
      invalid: 5,
      duplicateInFile: 3,
      duplicateExisting: 0,
      overLimit: 0,
    });
    expect(await db.getRepository(Guest).count()).toBe(0);

    const invalid = await asAdmin(
      server().get(
        `/api/admin/events/${event.id}/guest-imports/${data.id}/rows?result=INVALID`,
      ),
    ).expect(200);
    expect(invalid.body.data.meta.total).toBe(5);
    expect(invalid.body.data.items[0]).toMatchObject({
      rawPhone: '12345',
      reason: 'imports.row.phone_invalid',
    });

    const applied = await apply(event.id, data.id).expect(200);
    expect(applied.body.data.counts).toMatchObject({
      created: 300,
      skipped: 0,
    });
    const again = await apply(event.id, data.id).expect(200);
    expect(again.body.data.counts.created).toBe(300);
    expect(await db.getRepository(Guest).count()).toBe(300);
    expect((await reload(event.id)).listStatus).toBe(
      EventListStatus.IN_PROGRESS,
    );
  });

  it('marks existing numbers, the limit, reserve and bad types', async () => {
    const event = await createEvent({ invitationAllowance: 2, extraMargin: 1 });
    await addGuest(event.id, { name: 'موجود', phone: phone(1) }).expect(201);
    const preview = await upload(
      event.id,
      await sheet([
        ['موجود مرة أخرى', phone(1)],
        ['أول', phone(2), 'أساسي'],
        ['زائد', phone(3)],
        ['احتياطي', phone(4), 'احتياطي'],
        ['نوع خطأ', phone(5), 'مرافق'],
      ]),
    ).expect(200);
    expect(preview.body.data.counts).toMatchObject({
      valid: 2,
      invalid: 1,
      duplicateExisting: 1,
      overLimit: 1,
    });
  });

  it('neutralises formulas and rejects bad files (TC-IMP-05)', async () => {
    const event = await createEvent();
    const preview = await upload(
      event.id,
      await sheet([
        [{ formula: 'HYPERLINK("http://x.test","اضغط")' }, phone(1)],
      ]),
    ).expect(200);
    expect(preview.body.data.counts.invalid).toBe(1);
    const rows = await asAdmin(
      server().get(
        `/api/admin/events/${event.id}/guest-imports/${preview.body.data.id}/rows`,
      ),
    ).expect(200);
    expect(rows.body.data.items[0].rawName.startsWith("'=")).toBe(true);
    expect(rows.body.data.items[0].reason).toBe('imports.row.formula');

    const notXlsx = await upload(event.id, Buffer.from('name,phone\n')).expect(
      400,
    );
    expect(notXlsx.body.code).toBe('imports.unreadable');
    const noColumns = await upload(
      event.id,
      await sheet([['a', 'b']], ['first', 'second']),
    ).expect(400);
    expect(noColumns.body.code).toBe('imports.missing_columns');
  });

  it('refuses an expired preview', async () => {
    const event = await createEvent();
    const preview = await upload(
      event.id,
      await sheet([['محمد', phone(1)]]),
    ).expect(200);
    await db.getRepository(GuestImport).update(preview.body.data.id, {
      previewExpiresAt: new Date(Date.now() - 1000),
    });
    const res = await apply(event.id, preview.body.data.id).expect(409);
    expect(res.body.code).toBe('imports.expired');
  });

  it('never exceeds the allowance with two concurrent applies (TC-IMP-07)', async () => {
    const event = await createEvent({ invitationAllowance: 3, extraMargin: 0 });
    const a = await upload(
      event.id,
      await sheet([1, 2, 3].map((i) => [`أ ${i}`, phone(i)])),
    ).expect(200);
    const b = await upload(
      event.id,
      await sheet([4, 5, 6].map((i) => [`ب ${i}`, phone(i)])),
    ).expect(200);
    const results = await Promise.all([
      apply(event.id, a.body.data.id),
      apply(event.id, b.body.data.id),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await db.getRepository(Guest).count()).toBe(3);
    const created = results.map((r) => r.body.data.counts.created as number);
    expect(created.reduce((x, y) => x + y)).toBe(3);
  });

  it('moves the list to READY only with an initial guest', async () => {
    const event = await createEvent();
    const empty = await setList(event.id, 'READY').expect(422);
    expect(empty.body.code).toBe('guests.ready_requires_guest');

    const { body } = await addGuest(event.id, {
      name: 'محمد',
      phone: phone(1),
    }).expect(201);
    const ready = await setList(event.id, 'READY').expect(200);
    expect(ready.body.data).toMatchObject({
      listStatus: 'READY',
      stage: 'awaiting_approval',
    });

    // Removing the last initial guest makes the list not ready again.
    await csrf(
      asAdmin(
        server().delete(`/api/admin/events/${event.id}/guests/${body.data.id}`),
      ),
    ).expect(200);
    expect((await reload(event.id)).listStatus).toBe(
      EventListStatus.IN_PROGRESS,
    );
    const audits = await db
      .getRepository(AdminAction)
      .findBy({ targetId: event.id, action: 'event.list_status' });
    expect(audits[0].summary).toEqual({ from: 'IN_PROGRESS', to: 'READY' });
  });

  it('shows the owner a read-only list with masked phones, only for their own event (AC-03-4)', async () => {
    const event = await createEvent();
    await addGuest(event.id, { name: 'محمد العتيبي', phone: '0501234567' });
    await addGuest(event.id, {
      name: 'خالد',
      phone: phone(2),
      kind: 'RESERVE',
    });

    const res = await asOwner(
      server().get(`/api/events/${event.id}/guests?search=محمد`),
    ).expect(200);
    expect(res.body.data.items).toEqual([
      {
        id: expect.any(String),
        name: 'محمد العتيبي',
        maskedPhone: '+9665•••••567',
        kind: 'INITIAL',
        rsvp: 'PENDING',
        admitted: false,
      },
    ]);
    // Owners cannot search by phone digits.
    const byDigits = await asOwner(
      server().get(`/api/events/${event.id}/guests?search=4567`),
    ).expect(200);
    expect(byDigits.body.data.items).toHaveLength(0);

    const other = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: 'other@example.com',
        name: 'آخر',
        type: UserType.OWNER,
        status: UserStatus.ACTIVE,
      }),
    );
    const foreign = await createEvent({ ownerId: other.id });
    await asOwner(server().get(`/api/events/${foreign.id}/guests`)).expect(404);
  });

  it('serves the template to owners and admins', async () => {
    for (const as of [asOwner, asAdmin]) {
      const res = await as(server().get('/api/events/guest-list-template'))
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as ArrayBuffer);
      expect(workbook.worksheets[0].getRow(1).values).toEqual([
        undefined,
        'الاسم',
        'الجوال',
        'النوع',
        'ملاحظة',
      ]);
    }
  });

  it('gives the owner summary counts, only for their own event (AC-03-6, AC-03-7)', async () => {
    const event = await createEvent({
      invitationAllowance: 10,
      extraMargin: 2,
    });
    let seq = 0;
    const seed = async (
      guest: Partial<Guest>,
      invitation?: {
        state: WhatsappMessageState;
        delivery?: WhatsappDeliveryStatus;
      },
    ) => {
      const saved = await db.getRepository(Guest).save(
        db.getRepository(Guest).create({
          eventId: event.id,
          name: 'ضيف',
          phone: phone(100 + ++seq),
          allocationStatus: GuestAllocationStatus.ALLOCATED,
          ...guest,
        }),
      );
      if (invitation)
        await db.getRepository(WhatsappMessage).save(
          db.getRepository(WhatsappMessage).create({
            eventId: event.id,
            guestId: saved.id,
            kind: WhatsappMessageKind.INVITATION,
            logicalKey: `invitation:${saved.id}:1`,
            state: invitation.state,
            deliveryStatus: invitation.delivery ?? WhatsappDeliveryStatus.SENT,
          }),
        );
    };
    const sent = (delivery: WhatsappDeliveryStatus) => ({
      state: WhatsappMessageState.SENT,
      delivery,
    });

    await seed(
      { rsvp: GuestRsvp.ACCEPTED, checkedInAt: new Date() },
      sent(WhatsappDeliveryStatus.READ),
    );
    await seed(
      { rsvp: GuestRsvp.DECLINED },
      sent(WhatsappDeliveryStatus.DELIVERED),
    );
    await seed({}, sent(WhatsappDeliveryStatus.SENT));
    await seed({}, sent(WhatsappDeliveryStatus.FAILED));
    // An ambiguous send the guest still answered counts as invited.
    await seed(
      { rsvp: GuestRsvp.ACCEPTED },
      { state: WhatsappMessageState.UNKNOWN },
    );
    // Not reached yet: queued intent, or not allocated at all.
    await seed({}, { state: WhatsappMessageState.QUEUED });
    await seed({ allocationStatus: GuestAllocationStatus.NOT_ALLOCATED });
    await seed({
      kind: GuestKind.RESERVE,
      allocationStatus: GuestAllocationStatus.NOT_ALLOCATED,
    });

    const res = await asOwner(
      server().get(`/api/events/${event.id}/summary`),
    ).expect(200);
    expect(res.body.data).toEqual({
      invited: 5,
      delivered: 2,
      read: 1,
      accepted: 2,
      declined: 1,
      noReply: 2,
      extras: { cap: 2, used: 0, available: 1 },
      admitted: 1,
      updatedAt: expect.any(String),
    });

    await asAdmin(server().get(`/api/events/${event.id}/summary`)).expect(403);
    const stranger = await db.getRepository(User).save(
      db.getRepository(User).create({
        email: 'summary-stranger@example.com',
        name: 'آخر',
        type: UserType.OWNER,
        status: UserStatus.ACTIVE,
      }),
    );
    const foreign = await createEvent({ ownerId: stranger.id });
    await asOwner(server().get(`/api/events/${foreign.id}/summary`)).expect(
      404,
    );
  });
});
