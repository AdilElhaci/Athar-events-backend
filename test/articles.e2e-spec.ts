import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AdminAction } from '../src/modules/admin-actions/admin-action.entity';
import { ArticleImage } from '../src/modules/articles/entities/article-image.entity';
import { REDIS } from '../src/modules/auth/services/rate-limit.service';
import {
  User,
  UserStatus,
  UserType,
} from '../src/modules/users/entities/user.entity';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'قصر الضيافة 2026 مساءً';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const FULL_CONTENT = {
  excerpt: 'ملخص المقال',
  category: 'تخطيط المناسبات',
  readingMinutes: 4,
  coverUrl: '/articles/qr.png',
  coverAlt: 'بطاقة دعوة',
  sections: [{ heading: 'البداية', body: 'نص القسم' }],
  takeaway: 'الخلاصة',
};

describe('Articles (e2e)', () => {
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

  const createDraft = async (slug: string, extra: object = {}) => {
    const res = await asAdmin(http().post('/api/admin/articles'))
      .send({ title: 'مقال جديد', slug, ...extra })
      .expect(201);
    return res.body.data as { id: string; status: string; updatedAt: string };
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
    await redis.flushdb(); // fresh rate-limit counters per test
  });

  afterAll(async () => {
    await app.close();
  });

  describe('launch content', () => {
    it('seeds the five guides as published, featured guide first', async () => {
      const res = await http().get('/api/articles').expect(200);
      expect(res.body.data.meta.total).toBe(5);
      expect(res.body.data.items[0].slug).toBe('guest-list');
      expect(res.body.data.items[0].sections).toBeUndefined();

      const article = await http()
        .get('/api/articles/whatsapp-message')
        .expect(200);
      expect(article.body.data.sections.length).toBeGreaterThan(0);
      expect(article.body.data.coverUrl).toBe('/articles/message.png');
    });
  });

  describe('access', () => {
    it('refuses visitors and owners on every admin route', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await http().get('/api/admin/articles').expect(401);
      await asOwner(http().get('/api/admin/articles')).expect(403);
      await asOwner(http().get(`/api/admin/articles/${id}`)).expect(403);
      await asOwner(http().post('/api/admin/articles'))
        .send({ title: 'مقال', slug: 'owner-article' })
        .expect(403);
      await asOwner(http().patch(`/api/admin/articles/${id}`))
        .send({ title: 'مقال' })
        .expect(403);
      await asOwner(http().delete(`/api/admin/articles/${id}`)).expect(403);
      await asOwner(http().post('/api/admin/articles/images'))
        .attach('file', PNG, 'cover.png')
        .expect(403);
    });

    it('requires the CSRF header on mutations', async () => {
      await http()
        .post('/api/admin/articles')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ title: 'مقال', slug: 'no-csrf' })
        .expect(403);
    });
  });

  describe('lifecycle', () => {
    it('drafts stay hidden until published, then show until deleted', async () => {
      const draft = await createDraft('full-journey');
      expect(draft.status).toBe('DRAFT');

      await http().get('/api/articles/full-journey').expect(404);
      const hidden = await http().get('/api/articles?limit=100').expect(200);
      expect(
        hidden.body.data.items.map((a: { slug: string }) => a.slug),
      ).not.toContain('full-journey');

      await asAdmin(http().patch(`/api/admin/articles/${draft.id}`))
        .send({ ...FULL_CONTENT, status: 'PUBLISHED' })
        .expect(200);
      const shown = await http().get('/api/articles/full-journey').expect(200);
      expect(shown.body.data.publishedAt).toBeTruthy();

      await asAdmin(http().patch(`/api/admin/articles/${draft.id}`))
        .send({
          title: 'عنوان معدّل',
          sections: [{ heading: 'قسم واحد', body: 'نص' }],
        })
        .expect(200);
      const edited = await http().get('/api/articles/full-journey').expect(200);
      expect(edited.body.data.title).toBe('عنوان معدّل');
      expect(edited.body.data.sections).toHaveLength(1);
      expect(edited.body.data.publishedAt).toBe(shown.body.data.publishedAt);

      await asAdmin(http().patch(`/api/admin/articles/${draft.id}`))
        .send({ status: 'DRAFT' })
        .expect(200);
      await http().get('/api/articles/full-journey').expect(404);

      await asAdmin(http().delete(`/api/admin/articles/${draft.id}`)).expect(
        200,
      );
      await asAdmin(http().get(`/api/admin/articles/${draft.id}`)).expect(404);

      const actions = await db
        .getRepository(AdminAction)
        .findBy({ targetId: draft.id });
      expect(actions.map((a) => a.action).sort()).toEqual([
        'article.created',
        'article.deleted',
        'article.updated',
        'article.updated',
        'article.updated',
      ]);
    });

    it('refuses to publish an incomplete article', async () => {
      const draft = await createDraft('incomplete-article');
      const res = await asAdmin(http().patch(`/api/admin/articles/${draft.id}`))
        .send({ status: 'PUBLISHED' })
        .expect(422);
      expect(res.body.code).toBe('article.incomplete');

      const create = await asAdmin(http().post('/api/admin/articles'))
        .send({ title: 'مقال', slug: 'incomplete-new', status: 'PUBLISHED' })
        .expect(422);
      expect(create.body.code).toBe('article.incomplete');
    });

    it('publishes without a category or takeaway', async () => {
      const {
        category: _category,
        takeaway: _takeaway,
        ...basics
      } = FULL_CONTENT;
      await createDraft('basic-article', { ...basics, status: 'PUBLISHED' });
      const res = await http().get('/api/articles/basic-article').expect(200);
      expect(res.body.data.category).toBeNull();
      expect(res.body.data.takeaway).toBeNull();
    });

    it('enforces the published invariant in the database', async () => {
      await expect(
        db.query(
          `INSERT INTO "articles" ("slug", "title", "status", "published_at") VALUES ('raw-article', 'مقال', 'PUBLISHED', now())`,
        ),
      ).rejects.toThrow(/CHK_articles_published_complete/);
    });

    it('accepts a long article despite the small global body limit', async () => {
      await createDraft('long-article', {
        sections: Array.from({ length: 10 }, (_, i) => ({
          heading: `قسم ${i}`,
          body: 'نص '.repeat(1500),
        })),
      });
    });
  });

  describe('slug', () => {
    it('rejects duplicates and renames onto a taken slug', async () => {
      const first = await createDraft('taken-slug');
      const duplicate = await asAdmin(http().post('/api/admin/articles'))
        .send({ title: 'مقال آخر', slug: 'taken-slug' })
        .expect(409);
      expect(duplicate.body.code).toBe('article.slug_taken');

      const second = await createDraft('free-slug');
      const rename = await asAdmin(
        http().patch(`/api/admin/articles/${second.id}`),
      )
        .send({ slug: 'taken-slug' })
        .expect(409);
      expect(rename.body.code).toBe('article.slug_taken');

      await asAdmin(http().delete(`/api/admin/articles/${first.id}`)).expect(
        200,
      );
      await createDraft('taken-slug');
    });

    it('rejects non-url-safe slugs', async () => {
      for (const slug of ['مقال-عربي', 'Upper-Case', 'a b c', '-edge-']) {
        await asAdmin(http().post('/api/admin/articles'))
          .send({ title: 'مقال', slug })
          .expect(400);
      }
    });
  });

  describe('admin list', () => {
    it('searches the title literally and filters by status', async () => {
      await createDraft('searchable-one', { title: 'دليل 100% مميز' });

      const found = await asAdmin(
        http().get('/api/admin/articles').query({ search: '100%' }),
      ).expect(200);
      expect(found.body.data.items).toHaveLength(1);

      const none = await asAdmin(
        http().get('/api/admin/articles').query({ search: '1%0' }),
      ).expect(200);
      expect(none.body.data.items).toHaveLength(0);

      const drafts = await asAdmin(
        http()
          .get('/api/admin/articles')
          .query({ status: 'DRAFT', limit: 100 }),
      ).expect(200);
      expect(
        drafts.body.data.items.every(
          (a: { status: string }) => a.status === 'DRAFT',
        ),
      ).toBe(true);
    });
  });

  describe('cover images', () => {
    const upload = async () => {
      const res = await asAdmin(http().post('/api/admin/articles/images'))
        .attach('file', PNG, 'cover.png')
        .expect(201);
      return res.body.data.url as string;
    };

    it('serves an uploaded image as raw bytes with a long cache', async () => {
      const res = await http()
        .get(await upload())
        .expect(200);
      expect(res.headers['content-type']).toBe('image/png');
      expect(res.headers['cache-control']).toContain('immutable');
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    });

    it('rejects files that are not images, whatever they claim to be', async () => {
      const res = await asAdmin(http().post('/api/admin/articles/images'))
        .attach('file', Buffer.from('<svg></svg>'), {
          filename: 'cover.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(res.body.code).toBe('article.image_invalid');
    });

    it('rejects files over the size limit', async () => {
      await asAdmin(http().post('/api/admin/articles/images'))
        .attach(
          'file',
          Buffer.concat([PNG, Buffer.alloc(2_100_000)]),
          'big.png',
        )
        .expect(413);
    });

    it('rejects covers on other origins or missing uploads', async () => {
      await asAdmin(http().post('/api/admin/articles'))
        .send({
          title: 'مقال',
          slug: 'external-cover',
          coverUrl: 'https://evil.example/a.png',
        })
        .expect(400);
      const res = await asAdmin(http().post('/api/admin/articles'))
        .send({
          title: 'مقال',
          slug: 'missing-cover',
          coverUrl: '/api/articles/images/00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      expect(res.body.code).toBe('article.cover_invalid');
    });

    it('removes uploads when replaced and when the article is deleted', async () => {
      const images = db.getRepository(ArticleImage);
      const idOf = (url: string) => url.split('/').pop()!;

      const firstUrl = await upload();
      const draft = await createDraft('cover-cleanup', { coverUrl: firstUrl });
      const secondUrl = await upload();

      await asAdmin(http().patch(`/api/admin/articles/${draft.id}`))
        .send({ coverUrl: secondUrl })
        .expect(200);
      expect(await images.existsBy({ id: idOf(firstUrl) })).toBe(false);
      expect(await images.existsBy({ id: idOf(secondUrl) })).toBe(true);

      await asAdmin(http().delete(`/api/admin/articles/${draft.id}`)).expect(
        200,
      );
      expect(await images.existsBy({ id: idOf(secondUrl) })).toBe(false);
    });
  });
});
