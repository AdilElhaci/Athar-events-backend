import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { buildMeta, Paginated } from '../../shared/pagination';
import { AdminAction } from './admin-action.entity';
import { AdminActionsQueryDto, AdminActionView } from './dto/admin-action.dto';

/** SCR-28: the append-only admin action log, read only (AC-08-6). */
@Injectable()
export class AdminActionsService {
  constructor(private readonly dataSource: DataSource) {}

  async list({
    page,
    limit,
    eventId,
    actorId,
    action,
  }: AdminActionsQueryDto): Promise<Paginated<AdminActionView>> {
    const qb = this.dataSource
      .getRepository(AdminAction)
      .createQueryBuilder('a')
      .leftJoin('users', 'u', 'u.id = a.actor_user_id')
      .select([
        'a.id AS id',
        'a.action AS action',
        'a.target_type AS target_type',
        'a.target_id AS target_id',
        'a.summary AS summary',
        'a.created_at AS created_at',
        'u.id AS actor_id',
        'u.name AS actor_name',
        'u.email AS actor_email',
      ]);
    if (eventId)
      qb.andWhere(
        "(a.target_id = :eventId OR a.summary->>'eventId' = CAST(:eventId AS text))",
        { eventId },
      );
    if (actorId) qb.andWhere('a.actor_user_id = :actorId', { actorId });
    if (action) qb.andWhere('a.action = :action', { action });

    const total = await qb.getCount();
    const rows = await qb
      .orderBy('a.created_at', 'DESC')
      .addOrderBy('a.id', 'ASC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<{
        id: string;
        action: string;
        target_type: string;
        target_id: string | null;
        summary: Record<string, unknown>;
        created_at: Date;
        actor_id: string | null;
        actor_name: string | null;
        actor_email: string | null;
      }>();
    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        summary: r.summary ?? {},
        createdAt: new Date(r.created_at).toISOString(),
        actor: r.actor_id
          ? {
              id: r.actor_id,
              name: r.actor_name ?? '',
              email: r.actor_email ?? '',
            }
          : null,
      })),
      meta: buildMeta(total, page, limit),
    };
  }

  /** Action names present in the log, for the filter. */
  async actionNames(): Promise<string[]> {
    const rows = await this.dataSource.query<{ action: string }[]>(
      'SELECT DISTINCT action FROM admin_actions ORDER BY action',
    );
    return rows.map((r) => r.action);
  }
}
