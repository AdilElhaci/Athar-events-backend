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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { buildMeta, Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import {
  AdminTestimonialsQueryDto,
  AdminTestimonialView,
  CreateTestimonialDto,
  toAdminTestimonialView,
  UpdateTestimonialDto,
} from './dto/testimonial.dto';
import { TestimonialsService } from './testimonials.service';

@ApiTags('Admin — Testimonials')
@ApiBearerAuth()
@Controller('admin/testimonials')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminTestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @ApiOperation({ summary: 'Every review; search matches the author name.' })
  async list(
    @Query() query: AdminTestimonialsQueryDto,
  ): Promise<Paginated<AdminTestimonialView>> {
    const [rows, total] = await this.testimonials.listAll(query);
    return {
      items: rows.map(toAdminTestimonialView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminTestimonialView> {
    return toAdminTestimonialView(await this.testimonials.get(id));
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTestimonialDto,
  ) {
    const created = await this.testimonials.create(user.id, dto);
    return withMessage(toAdminTestimonialView(created), 'testimonial.created');
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Edit, publish or unpublish.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTestimonialDto,
  ) {
    const updated = await this.testimonials.update(user.id, id, dto);
    return withMessage(toAdminTestimonialView(updated), 'testimonial.updated');
  }

  @Delete(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Permanently delete a review.' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.testimonials.remove(user.id, id);
    return withMessage(null, 'testimonial.deleted');
  }
}
