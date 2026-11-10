import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { notFound } from '../../shared/exceptions/app.exception';
import { escapeLike } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  AdminTestimonialsQueryDto,
  CreateTestimonialDto,
  UpdateTestimonialDto,
} from './dto/testimonial.dto';
import { Testimonial, TestimonialStatus } from './entities/testimonial.entity';

/** Client reviews. Admin writes are audited without the review text. */
@Injectable()
export class TestimonialsService {
  constructor(
    @InjectRepository(Testimonial)
    private readonly testimonials: Repository<Testimonial>,
    private readonly dataSource: DataSource,
  ) {}

  listPublished(page: number, limit: number): Promise<[Testimonial[], number]> {
    return this.testimonials.findAndCount({
      where: { status: TestimonialStatus.PUBLISHED },
      order: { sortOrder: 'ASC', publishedAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  listAll({
    page,
    limit,
    search,
    status,
  }: AdminTestimonialsQueryDto): Promise<[Testimonial[], number]> {
    const term = search?.trim();
    return this.testimonials.findAndCount({
      where: {
        ...(status && { status }),
        ...(term && { authorName: ILike(`%${escapeLike(term)}%`) }),
      },
      order: { sortOrder: 'ASC', updatedAt: 'DESC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  async get(id: string): Promise<Testimonial> {
    const row = await this.testimonials.findOneBy({ id });
    if (!row) throw notFound();
    return row;
  }

  create(actorUserId: string, dto: CreateTestimonialDto): Promise<Testimonial> {
    const row = this.testimonials.create({
      ...dto,
      authorTitle: dto.authorTitle ?? null,
    });
    if (row.status === TestimonialStatus.PUBLISHED)
      row.publishedAt = new Date();
    return this.dataSource.transaction(async (manager) => {
      const created = await manager.save(row);
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'testimonial.created',
        targetType: 'testimonial',
        targetId: created.id,
        summary: { status: created.status },
      });
      return created;
    });
  }

  update(
    actorUserId: string,
    id: string,
    dto: UpdateTestimonialDto,
  ): Promise<Testimonial> {
    const changes = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Testimonial, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound();
      const fields = Object.keys(changes);
      if (!fields.length) return current;
      Object.assign(current, changes);
      if (current.status === TestimonialStatus.PUBLISHED)
        current.publishedAt ??= new Date();
      const updated = await manager.save(current);
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'testimonial.updated',
        targetType: 'testimonial',
        targetId: id,
        summary: { fields, status: updated.status },
      });
      return updated;
    });
  }

  /** Permanent: unpublishing is the reversible option. */
  remove(actorUserId: string, id: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Testimonial, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound();
      await manager.delete(Testimonial, { id });
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'testimonial.deleted',
        targetType: 'testimonial',
        targetId: id,
        summary: { status: current.status },
      });
    });
  }
}
