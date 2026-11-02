import { OmitType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import type { User } from '../../users/entities/user.entity';
import type { Event } from '../entities/event.entity';
import { nextActionOf, NextAction } from '../event-next-action';
import { EVENT_STAGES } from '../event-stage';
import type { EventStage } from '../event-stage';
import { EventView, toEventView, UpdateEventDto } from './event.dto';

export class AdminEventsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(EVENT_STAGES)
  stage?: EventStage;

  /** Only events waiting on an admin (SCR-20), soonest first. */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value,
  )
  @IsBoolean()
  needsAction?: boolean;
}

/** The package is frozen once chosen, so it cannot be corrected here. */
export class AdminUpdateEventDto extends OmitType(UpdateEventDto, [
  'packageId',
]) {
  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  admissionOpensAt?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  admissionClosesAt?: string;

  /** Kept in the admin action log. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 300)
  reason!: string;
}

/** A row of SCR-20 and SCR-20a (`IAdminEventListItem`). */
export interface AdminEventListItem {
  id: string;
  referenceCode: string;
  name: string;
  startsAt: Date;
  ownerName: string;
  packageName: string;
  stage: EventStage;
  nextAction: NextAction;
}

/** Admin shape of an event, with the owner's contact details (`IAdminEvent`). */
export interface AdminEventView extends EventView {
  stage: EventStage;
  owner: Pick<User, 'id' | 'name' | 'email' | 'phone'>;
}

export interface AdminDashboardView {
  stages: Record<EventStage, number>;
  alerts: { overdueCampaigns: number };
}

export const toAdminEventListItem = (
  event: Event,
  stage: EventStage,
): AdminEventListItem => ({
  id: event.id,
  referenceCode: event.referenceCode,
  name: event.name,
  startsAt: event.startsAt,
  ownerName: event.owner!.name,
  packageName: event.packageName,
  stage,
  nextAction: nextActionOf(event),
});

export const toAdminEventView = (
  event: Event,
  stage: EventStage,
): AdminEventView => {
  const { id, name, email, phone } = event.owner!;
  return {
    ...toEventView(event),
    stage,
    owner: { id, name, email, phone },
  };
};
