import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminTestimonialsController } from './admin-testimonials.controller';
import { Testimonial } from './entities/testimonial.entity';
import { TestimonialsController } from './testimonials.controller';
import { TestimonialsService } from './testimonials.service';

@Module({
  imports: [TypeOrmModule.forFeature([Testimonial]), AuthModule],
  controllers: [TestimonialsController, AdminTestimonialsController],
  providers: [TestimonialsService],
})
export class TestimonialsModule {}
