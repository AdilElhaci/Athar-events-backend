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
  AdminPaymentView,
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
