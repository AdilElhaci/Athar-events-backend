import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminAction } from '../src/modules/admin-actions/admin-action.entity';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const QUOTE = 'وصلت الدعوات في وقتها وكان الاستقبال سلساً جداً.';

describe('Testimonials (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let redis: Redis;
  let adminToken: string;
  let ownerToken: string;

  const http = () => request(app.getHttpServer());
  const withCsrf = (test: request.Test) =>
    test.set('Origin', ORIGIN).set('X-Requested-With', 'athar-events');
  const asAdmin = (test: request.Test) =>
    withCsrf(test).set('Authorization', `Bearer ${adminToken}`);
  const asOwner = (test: request.Test) =>
    withCsrf(test).set('Authorization', `Bearer ${ownerToken}`);

  const create = async (body: object) => {
    const res = await asAdmin(http().post('/api/admin/testimonials'))
      .send({ authorName: 'أم سارة', quote: QUOTE, ...body })
      .expect(201);
    return res.body.data as {
      id: string;
      status: string;
      publishedAt: string | null;
    };
  };

  async function signIn(email: string, type: UserType): Promise<string> {
    await db.getRepository(User).save(
      db.getRepository(User).create({
        email,
        name: 'مستخدم',
        type,
        status: UserStatus.ACTIVE,
        passwordHash: await argon2.hash(PASSWORD),
      }),
    );
    const res = await withCsrf(http().post('/api/auth/login'))
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
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
    adminToken = await signIn('admin@example.com', UserType.PLATFORM_ADMIN);
    ownerToken = await signIn('owner@example.com', UserType.OWNER);
  });

  beforeEach(async () => {
    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('only admins manage reviews', async () => {
    await asOwner(http().get('/api/admin/testimonials')).expect(403);
    await asOwner(http().post('/api/admin/testimonials'))
      .send({ authorName: 'أم سارة', quote: QUOTE })
      .expect(403);
    await http().get('/api/admin/testimonials').expect(401);
  });

  it('drafts stay private; published reviews are public in sort order', async () => {
    const draft = await create({ authorName: 'مسودة' });
    expect(draft.status).toBe('DRAFT');
    expect(draft.publishedAt).toBeNull();
    const second = await create({
      authorName: 'أبو فهد',
      authorTitle: 'حفل زواج · الرياض',
      status: 'PUBLISHED',
      sortOrder: 2,
    });
    expect(second.publishedAt).not.toBeNull();
    await create({ status: 'PUBLISHED', sortOrder: 1 });

    const res = await http().get('/api/testimonials').expect(200);
    const items = res.body.data.items as Array<Record<string, unknown>>;
    expect(items.map((item) => item.authorName)).toEqual([
      'أم سارة',
      'أبو فهد',
    ]);
    expect(items[1]).toEqual({
      id: second.id,
      authorName: 'أبو فهد',
      authorTitle: 'حفل زواج · الرياض',
      quote: QUOTE,
    });
  });

  it('validates, edits, publishes, unpublishes and deletes with an audit', async () => {
    await asAdmin(http().post('/api/admin/testimonials'))
      .send({ authorName: 'أ', quote: 'قصير' })
      .expect(400);
    const row = await create({ authorName: 'ضيف التعديل' });
    await asAdmin(http().patch(`/api/admin/testimonials/${row.id}`))
      .send({ authorName: null })
      .expect(400);

    const published = await asAdmin(
      http().patch(`/api/admin/testimonials/${row.id}`),
    )
      .send({ status: 'PUBLISHED', authorTitle: '  ' })
      .expect(200);
    expect(published.body.data.status).toBe('PUBLISHED');
    expect(published.body.data.authorTitle).toBeNull();
    let list = await http().get('/api/testimonials?limit=100').expect(200);
    expect(
      (list.body.data.items as Array<{ id: string }>).some(
        (item) => item.id === row.id,
      ),
    ).toBe(true);

    await asAdmin(http().patch(`/api/admin/testimonials/${row.id}`))
      .send({ status: 'DRAFT' })
      .expect(200);
    list = await http().get('/api/testimonials?limit=100').expect(200);
    expect(
      (list.body.data.items as Array<{ id: string }>).some(
        (item) => item.id === row.id,
      ),
    ).toBe(false);

    await asAdmin(http().delete(`/api/admin/testimonials/${row.id}`)).expect(
      200,
    );
    await asAdmin(http().get(`/api/admin/testimonials/${row.id}`)).expect(404);
    const actions = await db
      .getRepository(AdminAction)
      .find({ where: { targetId: row.id }, order: { createdAt: 'ASC' } });
    expect(actions.map((action) => action.action)).toEqual([
      'testimonial.created',
      'testimonial.updated',
      'testimonial.updated',
      'testimonial.deleted',
    ]);
    expect(JSON.stringify(actions)).not.toContain(QUOTE);
  });

  it('admin list searches by author name', async () => {
    await create({ authorName: 'عائلة القحطاني' });
    const res = await asAdmin(
      http().get('/api/admin/testimonials').query({ search: 'القحطاني' }),
    ).expect(200);
    expect(res.body.data.items).toHaveLength(1);
  });
});
