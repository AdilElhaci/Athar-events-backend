import { Transform } from 'class-transformer';
import {
  Equals,
  IsDateString,
  IsIn,
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

  /** D-54: «أقر بأن أرقام الضيوف المرسلة مصرّح بالتواصل معها عبر واتساب». */
  @Equals(true)
  contactConsent!: true;
}

export class OverrideApprovalDto {
  @IsUUID()
  contentId!: string;

  @Transform(trim)
  @IsString()
  @Length(3, 300)
  reason!: string;

  /** D-54: the owner made the contact declaration another way; the reason covers it. */
  @Equals(true)
  contactConsent!: true;
}

export class ScheduleDto {
  @IsDateString()
  sendAt!: string;

  /** SP-07: 7, 21 or 40 days. Without it only the invitation is sent. */
  @IsOptional()
  @IsIn([7, 21, 40])
  journey?: 7 | 21 | 40;

  /** Defaults to 18:00 two days before the event date (D-51). */
  @IsOptional()
  @IsDateString()
  rsvpClosesAt?: string;
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
  /** D-54. */
  contactConsent: boolean;
}

export type JourneyStepName =
  'FOLLOW_UP_1' | 'FOLLOW_UP_2' | 'REMINDER_1' | 'REMINDER_FINAL' | 'THANK_YOU';

/** SP-07: the schedule's journey and what each step did so far. */
export interface JourneyView {
  journey: 7 | 21 | 40 | null;
  sendAt: Date | null;
  rsvpClosesAt: Date | null;
  /** What scheduling would propose now, per journey; `fits` = its invitation day is still ahead. */
  proposals: Array<{
    journey: 7 | 21 | 40;
    sendAt: Date;
    rsvpClosesAt: Date;
    fits: boolean;
  }>;
  steps: Array<{
    step: JourneyStepName;
    dueAt: Date;
    /** Messages of this step by state (created when due). */
    counts: { queued: number; sent: number; failed: number; skipped: number };
  }>;
  /** Late replies waiting for an admin (D-53). */
  pendingReviews: number;
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
  journey: JourneyView;
  /** D-54: when and by whom (owner or admin) the contact declaration was made. */
  contactConsent: { at: Date; by: 'OWNER' | 'ADMIN' } | null;
}

export interface OwnerInvitationView {
  content: InvitationContentView | null;
  /** The owner can approve the latest version now (or make the missing declaration). */
  approvable: boolean;
  /** D-54: when the contact declaration was made; null = still needed. */
  contactConsentAt: Date | null;
}
