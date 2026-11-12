import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import type { AdminGuestView } from '../../guests/dto/guest.dto';

/** Either `count` (oldest declines and reserves first) or explicit reserve `guestIds`. */
export class SendReplacementsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  count?: number;

  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  guestIds?: string[];
}

export interface ExtrasView {
  cap: number;
  used: number;
  available: number;
}

export interface ReplacementGuest {
  id: string;
  name: string;
  phone: string | null;
}

export interface ReplacementsView {
  extras: ExtrasView;
  eligibleDeclines: Array<ReplacementGuest & { rsvpAt: string | null }>;
  reserves: ReplacementGuest[];
  sent: Array<
    ReplacementGuest & {
      rsvp: string;
      replacedGuestName: string;
      allocatedAt: string | null;
    }
  >;
  /** Why sending is not possible right now, if it is not. */
  blockedReason: string | null;
}

export interface SendReplacementsResult {
  allocated: AdminGuestView[];
  extras: ExtrasView;
}
