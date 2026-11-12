import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';

export class AdminActionsQueryDto extends PaginationQueryDto {
  /** Actions on the event itself and on its messages, payments and guests. */
  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z_]+\.[a-z_]+$/)
  action?: string;
}

export interface AdminActionView {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  /** Counts, field names and the admin's reason; never guest or owner personal data. */
  summary: Record<string, unknown>;
  createdAt: string;
  /** Null for the server CLI. */
  actor: { id: string; name: string; email: string } | null;
}
