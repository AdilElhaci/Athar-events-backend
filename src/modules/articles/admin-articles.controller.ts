import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { badRequest } from '../../shared/exceptions/app.exception';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { buildMeta, Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { coverUrlFor, MAX_COVER_BYTES } from './article-image';
import { ArticlesService } from './articles.service';
import {
  AdminArticleListItemView,
  AdminArticlesQueryDto,
  AdminArticleView,
  CreateArticleDto,
  toAdminArticleListItemView,
  toAdminArticleView,
  UpdateArticleDto,
} from './dto/article.dto';

@ApiTags('Admin — Articles')
@ApiBearerAuth()
@Controller('admin/articles')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminArticlesController {
  constructor(private readonly articles: ArticlesService) {}

  @Get()
  @ApiOperation({
    summary: 'Every article; search matches the title literally.',
  })
  async list(
    @Query() query: AdminArticlesQueryDto,
  ): Promise<Paginated<AdminArticleListItemView>> {
    const [rows, total] = await this.articles.listAll(query);
    return {
      items: rows.map(toAdminArticleListItemView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminArticleView> {
    return toAdminArticleView(await this.articles.get(id));
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateArticleDto,
  ) {
    const created = await this.articles.create(user.id, dto);
    return withMessage(toAdminArticleView(created), 'article.created');
  }

  @Post('images')
  @UseGuards(CsrfGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_COVER_BYTES, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a cover (JPEG, PNG or WebP, 2 MB at most).',
  })
  async uploadImage(@UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw badRequest('article.image_invalid');
    const image = await this.articles.saveImage(file.buffer);
    return withMessage(
      { url: coverUrlFor(image.id) },
      'article.image_uploaded',
    );
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Edit, publish or unpublish.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateArticleDto,
  ) {
    const updated = await this.articles.update(user.id, id, dto);
    return withMessage(toAdminArticleView(updated), 'article.updated');
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Permanently delete an article and its uploaded cover.',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.articles.remove(user.id, id);
    return withMessage(null, 'article.deleted');
  }
}
