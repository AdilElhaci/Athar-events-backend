import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository } from 'typeorm';
import {
  conflict,
  notFound,
  serviceUnavailable,
} from '../../shared/exceptions/app.exception';
import { buildMeta, escapeLike, Paginated } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import {
  AdminPaymentsQueryDto,
  AdminPaymentStatsView,
  AdminPaymentView,
  MonthlyRevenue,
  REFUND_NEEDED_CODES,
} from './dto/admin-payment.dto';
import {
  PaymentAttempt,
  PaymentAttemptStatus,
} from './entities/payment-attempt.entity';
import { PaymentApplyService } from './payment-apply.service';

const refundNeeded = (attempt: PaymentAttempt) =>
  attempt.status === PaymentAttemptStatus.FAILED &&
  (REFUND_NEEDED_CODES as readonly string[]).includes(
    attempt.failureCode ?? '',
  ) &&
  !attempt.metadata?.refundedAt;

/** SQL twin of `refundNeeded` (alias `p`). */
export const REFUND_NEEDED_SQL = `p.status = 'FAILED' AND p.failure_code IN (${REFUND_NEEDED_CODES.map((c) => `'${c}'`).join(', ')}) AND p.metadata->>'refundedAt' IS NULL`;

/** Business months follow Saudi time. */
const TZ = 'Asia/Riyadh';

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toAdminPaymentView(attempt: PaymentAttempt): AdminPaymentView {
  const meta = attempt.metadata ?? {};
  return {
    id: attempt.id,
    status: attempt.status,
    amount: attempt.amount,
    currency: attempt.currency,
    moyasarInvoiceId: attempt.moyasarInvoiceId,
    moyasarPaymentId: attempt.moyasarPaymentId,
    failureCode: attempt.failureCode,
    refundNeeded: refundNeeded(attempt),
    refundedAt: typeof meta.refundedAt === 'string' ? meta.refundedAt : null,
    card: {
      ...(typeof meta.brand === 'string' ? { brand: meta.brand } : {}),
      ...(typeof meta.last4 === 'string' ? { last4: meta.last4 } : {}),
    },
    createdAt: attempt.createdAt.toISOString(),
    paidAt: iso(attempt.paidAt),
    expiresAt: iso(attempt.expiresAt),
    lastReconciledAt: iso(attempt.lastReconciledAt),
    event: {
      id: attempt.event!.id,
      name: attempt.event!.name,
      referenceCode: attempt.event!.referenceCode,
      status: attempt.event!.status,
      paymentStatus: attempt.event!.paymentStatus,
    },
    owner: {
      id: attempt.owner!.id,
      name: attempt.owner!.name,
      email: attempt.owner!.email,
    },
  };
}

/** SCR-26: every payment attempt, newest first (AC-08-5). */
@Injectable()
export class AdminPaymentsService {
  private readonly logger = new Logger(AdminPaymentsService.name);

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attempts: Repository<PaymentAttempt>,
    private readonly apply: PaymentApplyService,
    private readonly dataSource: DataSource,
  ) {}

  async list({
    page,
    limit,
    search,
    status,
    needsAction,
  }: AdminPaymentsQueryDto): Promise<Paginated<AdminPaymentView>> {
    const qb = this.withJoins();
    const term = search?.trim();
    if (term)
      qb.andWhere(
        new Brackets((where) =>
          where
            .where("e.name ILIKE :term ESCAPE '\\'")
            .orWhere("e.referenceCode ILIKE :term ESCAPE '\\'")
            .orWhere("owner.name ILIKE :term ESCAPE '\\'")
            .orWhere("owner.email ILIKE :term ESCAPE '\\'")
            .orWhere("p.moyasarInvoiceId ILIKE :term ESCAPE '\\'")
            .orWhere("p.moyasarPaymentId ILIKE :term ESCAPE '\\'"),
        ),
        { term: `%${escapeLike(term)}%` },
      );
    if (status) qb.andWhere('p.status = :status', { status });
    if (needsAction) qb.andWhere(REFUND_NEEDED_SQL);
    const [rows, total] = await qb
      .orderBy('p.createdAt', 'DESC')
      .addOrderBy('p.id', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();
    return {
      items: rows.map(toAdminPaymentView),
      meta: buildMeta(total, page, limit),
    };
  }

  /**
   * Monthly income and event counts. Revenue is the PAID attempts by the month they were paid,
   * minus the ones refunded by hand (`metadata.refundedAt`); refunds are reported apart.
   */
  async stats(): Promise<AdminPaymentStatsView> {
    const [months, totals, events] = await Promise.all([
      this.dataSource.query<
        { month: string; revenue: string; paid_count: string }[]
      >(
        `WITH months AS (
           SELECT generate_series(
             date_trunc('month', now() AT TIME ZONE '${TZ}') - interval '5 months',
             date_trunc('month', now() AT TIME ZONE '${TZ}'),
             interval '1 month'
           ) AS month
         )
         SELECT to_char(m.month, 'YYYY-MM') AS month,
                COALESCE(SUM(p.amount) FILTER (WHERE p.metadata->>'refundedAt' IS NULL), 0) AS revenue,
                COUNT(p.id) FILTER (WHERE p.metadata->>'refundedAt' IS NULL) AS paid_count
           FROM months m
           LEFT JOIN payment_attempts p
             ON p.status = 'PAID'
            AND date_trunc('month', p.paid_at AT TIME ZONE '${TZ}') = m.month
          GROUP BY m.month
          ORDER BY m.month`,
      ),
      this.dataSource.query<
        {
          total_revenue: string;
          total_refunded: string;
          refunded_this_month: string;
        }[]
      >(
        `SELECT COALESCE(SUM(amount) FILTER (WHERE metadata->>'refundedAt' IS NULL), 0) AS total_revenue,
                COALESCE(SUM(amount) FILTER (WHERE metadata->>'refundedAt' IS NOT NULL), 0) AS total_refunded,
                COALESCE(SUM(amount) FILTER (
                  WHERE metadata->>'refundedAt' IS NOT NULL
                    AND date_trunc('month', (metadata->>'refundedAt')::timestamptz AT TIME ZONE '${TZ}')
                      = date_trunc('month', now() AT TIME ZONE '${TZ}')
                ), 0) AS refunded_this_month
           FROM payment_attempts
          WHERE status = 'PAID'`,
      ),
      this.dataSource.query<Record<string, string>[]>(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft,
                COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active,
                COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed,
                COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
                COUNT(*) FILTER (WHERE payment_status = 'PAID') AS paid,
                COUNT(*) FILTER (
                  WHERE date_trunc('month', created_at AT TIME ZONE '${TZ}')
                      = date_trunc('month', now() AT TIME ZONE '${TZ}')
                ) AS new_this_month
           FROM events`,
      ),
    ]);
    const monthly: MonthlyRevenue[] = months.map((row) => ({
      month: row.month,
      revenue: Number(row.revenue),
      paidCount: Number(row.paid_count),
    }));
    const [current, previous] = [monthly.at(-1)!, monthly.at(-2)!];
    const count = events[0];
    return {
      thisMonth: {
        ...current,
        refunded: Number(totals[0].refunded_this_month),
        newEvents: Number(count.new_this_month),
      },
      lastMonth: previous,
      totalRevenue: Number(totals[0].total_revenue),
      totalRefunded: Number(totals[0].total_refunded),
      monthly,
      events: {
        total: Number(count.total),
        draft: Number(count.draft),
        active: Number(count.active),
        closed: Number(count.closed),
        cancelled: Number(count.cancelled),
        paid: Number(count.paid),
      },
    };
  }

  /** Forces a Moyasar fetch for a `PENDING` attempt (SCR-26 "Reconcile"); audited. */
  async reconcile(actorUserId: string, id: string): Promise<AdminPaymentView> {
    const attempt = await this.attempts.findOneBy({ id });
    if (!attempt) throw notFound();
    if (
      attempt.status !== PaymentAttemptStatus.PENDING ||
      !attempt.moyasarInvoiceId
    )
      throw conflict('payments.not_pending');
    let after: PaymentAttempt;
    try {
      after = await this.apply.refresh(attempt);
    } catch (error) {
      this.logger.warn(
        `Admin reconcile of attempt ${id} failed: ${(error as Error).message}`,
      );
      throw serviceUnavailable('payments.provider_unavailable');
    }
    await this.dataSource.getRepository(AdminAction).insert({
      actorUserId,
      action: 'payment.reconcile',
      targetType: 'payment',
      targetId: id,
      summary: {
        eventId: attempt.eventId,
        from: attempt.status,
        to: after.status,
        ...(after.failureCode ? { failureCode: after.failureCode } : {}),
      },
    });
    return this.view(id);
  }

  /**
   * Records that the money of an attempt the platform never applied was returned by hand in the
   * Moyasar dashboard, which clears its alert. Paid events are refunded through
   * `POST /admin/events/:id/mark-refunded` instead, because that also cancels the event.
   */
  async markRefundDone(
    actorUserId: string,
    id: string,
    reason: string,
  ): Promise<AdminPaymentView> {
    await this.dataSource.transaction(async (manager) => {
      const attempt = await manager.findOne(PaymentAttempt, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!attempt) throw notFound();
      if (!refundNeeded(attempt)) throw conflict('payments.no_refund_needed');
      attempt.metadata = {
        ...attempt.metadata,
        refundedAt: new Date().toISOString(),
      };
      await manager.save(attempt);
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'payment.refund_done',
        targetType: 'payment',
        targetId: id,
        summary: {
          eventId: attempt.eventId,
          failureCode: attempt.failureCode ?? undefined,
          reason,
        },
      });
    });
    return this.view(id);
  }

  private async view(id: string): Promise<AdminPaymentView> {
    const row = await this.withJoins().andWhere('p.id = :id', { id }).getOne();
    if (!row) throw notFound();
    return toAdminPaymentView(row);
  }

  /** Only the owner columns the view needs: the password hash stays out of memory. */
  private withJoins() {
    return this.attempts
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.event', 'e')
      .innerJoin('p.owner', 'owner')
      .addSelect(['owner.id', 'owner.name', 'owner.email']);
  }
}
