import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import {
  InvitationContent,
  InvitationVariables,
} from '../entities/invitation-content.entity';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Content rules (length, single line) are checked by the service so the error has a code. */
export class CreateInvitationDto implements InvitationVariables {
  @IsString()
  @MaxLength(300)
  eventName!: string;

  @IsString()
  @MaxLength(300)
  dateText!: string;

  @IsString()
  @MaxLength(300)
  venue!: string;
}

export class ApproveInvitationDto {
  @IsUUID()
  contentId!: string;

  @IsString()
  @Length(64, 64)
  contentHash!: string;
}

export class OverrideApprovalDto {
  @IsUUID()
  contentId!: string;

  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason!: string;
}

export class ScheduleDto {
  @IsDateString()
  sendAt!: string;
}

export class UnscheduleDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  reason?: string;
}

export interface InvitationContentView {
  id: string;
  version: number;
  templateName: string;
  variables: InvitationVariables;
  renderedPreview: string;
  buttons: readonly string[];
  contentHash: string;
  approvedAt: Date | null;
  /** Who approved: the owner, or an admin with a recorded reason. */
  approvedBy: 'OWNER' | 'ADMIN' | null;
  overrideReason: string | null;
  createdAt: Date;
}

export const toContentView = (
  content: InvitationContent,
  buttons: readonly string[],
  ownerId: string,
): InvitationContentView => ({
  id: content.id,
  version: content.version,
  templateName: content.templateName,
  variables: content.variables,
  renderedPreview: content.renderedPreview,
  buttons,
  contentHash: content.contentHash,
  approvedAt: content.approvedAt,
  approvedBy: !content.approvedAt
    ? null
    : content.approvedByUserId === ownerId
      ? 'OWNER'
      : 'ADMIN',
  overrideReason: content.overrideReason,
  createdAt: content.createdAt,
});

export interface CampaignPreconditions {
  paid: boolean;
  listReady: boolean;
  approved: boolean;
  templateApproved: boolean;
}

export interface AdminInvitationView {
  template: {
    name: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    body: string;
    buttons: readonly string[];
  };
  content: InvitationContentView | null;
  versions: number;
  suggested: InvitationVariables;
  preconditions: CampaignPreconditions;
}

export interface OwnerInvitationView {
  content: InvitationContentView | null;
  /** The owner can approve the latest version now. */
  approvable: boolean;
}
