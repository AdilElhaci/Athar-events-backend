import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  buildMeta,
  Paginated,
  PaginationQueryDto,
} from '../../shared/pagination';
import {
  ArticleCardView,
  ArticleView,
  toArticleCardView,
  toArticleView,
} from './dto/article.dto';
import { ArticlesService } from './articles.service';

@ApiTags('Articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  @ApiOperation({ summary: 'Published articles, newest first (public).' })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<ArticleCardView>> {
    const [rows, total] = await this.articles.listPublished(
      query.page,
      query.limit,
    );
    return {
      items: rows.map(toArticleCardView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  /** Raw bytes, so it bypasses the JSON envelope. An id is never reused, so it caches forever. */
  @Get('images/:id')
  @ApiOperation({ summary: 'Uploaded cover image (public).' })
  async image(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const image = await this.articles.getImage(id);
    response
      .set({
        'Content-Type': image.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
      })
      .send(image.data);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'One published article; 404 for drafts (public).' })
  async get(@Param('slug') slug: string): Promise<ArticleView> {
    return toArticleView(await this.articles.getPublished(slug));
  }
}
