import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import { PaymentAttemptStatus } from '../entities/payment-attempt.entity';

const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value;

/**
 * Failure codes of attempts whose money Moyasar took but the platform did not apply: each needs
 * a manual refund in the Moyasar dashboard (AC-05-5).
 */
export const REFUND_NEEDED_CODES = [
  'duplicate_payment',
  'event_not_payable',
  'mismatch',
] as const;

export class AdminPaymentsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(PaymentAttemptStatus)
  status?: PaymentAttemptStatus;

  /** Paid at Moyasar but not applied (`REFUND_NEEDED_CODES`). */
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  needsAction?: boolean;
}

export interface AdminPaymentView {
  id: string;
  status: PaymentAttemptStatus;
  amount: number;
  currency: string;
  moyasarInvoiceId: string | null;
  moyasarPaymentId: string | null;
  failureCode: string | null;
  /** True when Moyasar holds money the platform did not apply. */
  refundNeeded: boolean;
  /** When an admin recorded the manual refund of an unapplied payment. */
  refundedAt: string | null;
  card: { brand?: string; last4?: string };
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  lastReconciledAt: string | null;
  event: {
    id: string;
    name: string;
    referenceCode: string;
    status: string;
    paymentStatus: string;
  };
  owner: { id: string; name: string; email: string };
}

/** A reason is kept in the admin action log. */
export class RefundReasonDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 300)
  reason!: string;
}

/** One month of net revenue (Asia/Riyadh calendar). */
export interface MonthlyRevenue {
  /** `YYYY-MM`. */
  month: string;
  /** Halalas paid that month and not refunded. */
  revenue: number;
  paidCount: number;
}

/** Figures for the top of SCR-26. Amounts are halalas, months follow Asia/Riyadh. */
export interface AdminPaymentStatsView {
  thisMonth: MonthlyRevenue & { refunded: number; newEvents: number };
  lastMonth: MonthlyRevenue;
  totalRevenue: number;
  totalRefunded: number;
  /** The last six months, oldest first, the current month included. */
  monthly: MonthlyRevenue[];
  events: {
    total: number;
    draft: number;
    active: number;
    closed: number;
    cancelled: number;
    paid: number;
  };
}
