import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  ILike,
  QueryFailedError,
  Repository,
} from 'typeorm';
import {
  badRequest,
  conflict,
  notFound,
  unprocessable,
} from '../../shared/exceptions/app.exception';
import { escapeLike } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { coverImageId, detectImageType } from './article-image';
import {
  AdminArticlesQueryDto,
  CreateArticleDto,
  UpdateArticleDto,
} from './dto/article.dto';
import { ArticleImage } from './entities/article-image.entity';
import { Article, ArticleStatus } from './entities/article.entity';

const SLUG_CONSTRAINT = 'UQ_articles_slug';

/** Category and takeaway are optional extras; the admin form no longer asks for them. */
const REQUIRED_TO_PUBLISH = [
  'excerpt',
  'readingMinutes',
  'coverUrl',
  'coverAlt',
] as const;

/** Clear error for the admin; `CHK_articles_published_complete` is the actual guarantee. */
function assertPublishable(article: Article): void {
  if (
    !article.sections.length ||
    REQUIRED_TO_PUBLISH.some((field) => article[field] == null)
  )
    throw unprocessable('article.incomplete');
}

/** Turns a slug collision, which only the database can detect reliably, into its own error. */
async function withSlugCheck<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const driverError =
      error instanceof QueryFailedError
        ? (error.driverError as { constraint?: string })
        : undefined;
    if (driverError?.constraint === SLUG_CONSTRAINT)
      throw conflict('article.slug_taken');
    throw error;
  }
}

@Injectable()
export class ArticlesService {
  constructor(
    @InjectRepository(Article) private readonly articles: Repository<Article>,
    @InjectRepository(ArticleImage)
    private readonly images: Repository<ArticleImage>,
    private readonly dataSource: DataSource,
  ) {}

  listPublished(page: number, limit: number): Promise<[Article[], number]> {
    return this.articles.findAndCount({
      where: { status: ArticleStatus.PUBLISHED },
      order: { publishedAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async getPublished(slug: string): Promise<Article> {
    const article = await this.articles.findOneBy({
      slug,
      status: ArticleStatus.PUBLISHED,
    });
    if (!article) throw notFound();
    return article;
  }

  listAll({
    page,
    limit,
    search,
    status,
  }: AdminArticlesQueryDto): Promise<[Article[], number]> {
    const term = search?.trim();
    return this.articles.findAndCount({
      where: {
        ...(status && { status }),
        ...(term && { title: ILike(`%${escapeLike(term)}%`) }),
      },
      order: { updatedAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async get(id: string): Promise<Article> {
    const article = await this.articles.findOneBy({ id });
    if (!article) throw notFound();
    return article;
  }

  async create(actorUserId: string, dto: CreateArticleDto): Promise<Article> {
    const article = this.articles.create({
      ...dto,
      sections: dto.sections ?? [],
    });
    if (article.status === ArticleStatus.PUBLISHED) {
      assertPublishable(article);
      article.publishedAt = new Date();
    }
    await this.assertCoverExists(dto.coverUrl);

    return withSlugCheck(() =>
      this.dataSource.transaction(async (manager) => {
        const created = await manager.save(article);
        await manager.insert(AdminAction, {
          actorUserId,
          action: 'article.created',
          targetType: 'article',
          targetId: created.id,
          summary: { status: created.status },
        });
        return created;
      }),
    );
  }

  async update(
    actorUserId: string,
    id: string,
    dto: UpdateArticleDto,
  ): Promise<Article> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    await this.assertCoverExists(dto.coverUrl);

    return withSlugCheck(() =>
      this.dataSource.transaction(async (manager) => {
        const current = await manager.findOne(Article, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) throw notFound();
        const fields = Object.keys(changes);
        if (!fields.length) return current;

        const previousCover = current.coverUrl;
        Object.assign(current, changes);
        if (current.status === ArticleStatus.PUBLISHED) {
          assertPublishable(current);
          current.publishedAt ??= new Date();
        }
        const updated = await manager.save(current);
        if (previousCover !== updated.coverUrl)
          await this.dropUnusedCover(manager, previousCover);
        await manager.insert(AdminAction, {
          actorUserId,
          action: 'article.updated',
          targetType: 'article',
          targetId: id,
          summary: { fields, status: updated.status },
        });
        return updated;
      }),
    );
  }

  /** Permanent: the action log keeps the only trace. Unpublishing is the reversible option. */
  remove(actorUserId: string, id: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Article, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound();

      await manager.delete(Article, { id });
      await this.dropUnusedCover(manager, current.coverUrl);
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'article.deleted',
        targetType: 'article',
        targetId: id,
        summary: { status: current.status },
      });
    });
  }

  async saveImage(data: Buffer): Promise<ArticleImage> {
    const contentType = detectImageType(data);
    if (!contentType) throw badRequest('article.image_invalid');
    return this.images.save(this.images.create({ data, contentType }));
  }

  async getImage(id: string): Promise<ArticleImage> {
    const image = await this.images.findOneBy({ id });
    if (!image) throw notFound();
    return image;
  }

  private async assertCoverExists(url?: string | null): Promise<void> {
    const id = coverImageId(url);
    if (id && !(await this.images.existsBy({ id })))
      throw badRequest('article.cover_invalid');
  }

  private async dropUnusedCover(
    manager: EntityManager,
    url: string | null,
  ): Promise<void> {
    const id = coverImageId(url);
    if (!id || (await manager.existsBy(Article, { coverUrl: url! }))) return;
    await manager.delete(ArticleImage, { id });
  }
}
