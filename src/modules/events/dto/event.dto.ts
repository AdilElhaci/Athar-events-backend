import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import {
  Event,
  EventApprovalStatus,
  EventCampaignStatus,
  EventListStatus,
  EventPaymentStatus,
  EventStatus,
} from '../entities/event.entity';
import { nextActionOf, NextAction } from '../event-next-action';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Empty optional fields are stored as null. */
const trimToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

const NameField = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 120));
const VenueField = () =>
  applyDecorators(Transform(trim), IsString(), Length(2, 160));
const DateField = () => IsISO8601({ strict: true, strictSeparator: true });
const MapUrlField = () =>
  applyDecorators(
    Transform(trimToNull),
    IsOptional(),
    IsUrl({ protocols: ['https'], require_protocol: true }),
    MaxLength(500),
  );
const SendTimeField = () =>
  applyDecorators(Transform(trimToNull), IsOptional(), DateField());
/** May be left out of a PATCH, but unlike `IsOptional` it refuses null. */
const Omittable = () => ValidateIf((_, value) => value !== undefined);

export class CreateEventDto {
  @IsUUID()
  packageId!: string;

  @NameField()
  name!: string;

  @DateField()
  startsAt!: string;

  @VenueField()
  venueName!: string;

  @MapUrlField()
  venueMapUrl?: string | null;

  @SendTimeField()
  requestedSendAt?: string | null;
}

export class UpdateEventDto {
  @Omittable()
  @IsUUID()
  packageId?: string;

  @Omittable()
  @NameField()
  name?: string;

  @Omittable()
  @DateField()
  startsAt?: string;

  @Omittable()
  @VenueField()
  venueName?: string;

  @MapUrlField()
  venueMapUrl?: string | null;

  @SendTimeField()
  requestedSendAt?: string | null;
}

export class ListEventsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(EventStatus)
  status?: EventStatus;
}

/** Owner's shape of an event (`IEvent`). */
export interface EventView {
  id: string;
  referenceCode: string;
  name: string;
  startsAt: Date;
  timezone: string;
  venueName: string;
  venueMapUrl: string | null;
  requestedSendAt: Date | null;
  sendAt: Date | null;
  package: {
    id: string | null;
    name: string;
    invitationAllowance: number;
    extraMargin: number;
    priceHalalas: number;
    currency: string;
  };
  status: EventStatus;
  paymentStatus: EventPaymentStatus;
  listStatus: EventListStatus;
  approvalStatus: EventApprovalStatus;
  campaignStatus: EventCampaignStatus;
  nextAction: NextAction;
  editable: boolean;
  packageEditable: boolean;
  admissionOpensAt: Date;
  admissionClosesAt: Date;
  paidAt: Date | null;
  createdAt: Date;
}

/** Owner edits end at invitation approval or scheduling (SP-02, OQ-16). */
export const isEditable = (event: Event): boolean =>
  (event.status === EventStatus.DRAFT || event.status === EventStatus.ACTIVE) &&
  event.approvalStatus !== EventApprovalStatus.APPROVED &&
  event.campaignStatus === EventCampaignStatus.NOT_SCHEDULED;

/** The snapshot is frozen once checkout has started (AC-04-2). */
export const isPackageEditable = (event: Event): boolean =>
  isEditable(event) && event.paymentStatus === EventPaymentStatus.UNPAID;

export const toEventView = (event: Event): EventView => ({
  id: event.id,
  referenceCode: event.referenceCode,
  name: event.name,
  startsAt: event.startsAt,
  timezone: event.timezone,
  venueName: event.venueName,
  venueMapUrl: event.venueMapUrl,
  requestedSendAt: event.requestedSendAt,
  sendAt: event.sendAt,
  package: {
    id: event.packageId,
    name: event.packageName,
    invitationAllowance: event.invitationAllowance,
    extraMargin: event.extraMargin,
    priceHalalas: event.priceHalalas,
    currency: event.currency,
  },
  status: event.status,
  paymentStatus: event.paymentStatus,
  listStatus: event.listStatus,
  approvalStatus: event.approvalStatus,
  campaignStatus: event.campaignStatus,
  nextAction: nextActionOf(event),
  editable: isEditable(event),
  packageEditable: isPackageEditable(event),
  admissionOpensAt: event.admissionOpensAt,
  admissionClosesAt: event.admissionClosesAt,
  paidAt: event.paidAt,
  createdAt: event.createdAt,
});
