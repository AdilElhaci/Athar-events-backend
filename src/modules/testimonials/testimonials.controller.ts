import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  buildMeta,
  Paginated,
  PaginationQueryDto,
} from '../../shared/pagination';
import { TestimonialView, toTestimonialView } from './dto/testimonial.dto';
import { TestimonialsService } from './testimonials.service';

@ApiTags('Testimonials')
@Controller('testimonials')
export class TestimonialsController {
  constructor(private readonly testimonials: TestimonialsService) {}

  @Get()
  @ApiOperation({ summary: 'Published client reviews (public).' })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<TestimonialView>> {
    const [rows, total] = await this.testimonials.listPublished(
      query.page,
      query.limit,
    );
    return {
      items: rows.map(toTestimonialView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }
}
