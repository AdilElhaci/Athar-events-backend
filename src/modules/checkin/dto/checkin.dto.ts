import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CheckInDto {
  @ApiProperty({ description: 'Raw QR token or the full guest-page URL.' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  token!: string;
}

export type ScanResult =
  | 'ADMITTED'
  | 'ALREADY_ADMITTED'
  | 'INVALID'
  | 'NOT_ACCEPTED'
  | 'WRONG_EVENT'
  | 'WINDOW_CLOSED';

export interface CheckInResponse {
  result: ScanResult;
  guestName?: string;
  checkedInAt?: string;
  admittedCount: number;
}

export interface ScanEventView {
  id: string;
  name: string;
  startsAt: string;
  admissionOpensAt: string;
  admissionClosesAt: string;
  isOpen: boolean;
}

export interface ScanStats {
  admitted: number;
  accepted: number;
}

export interface PublicInvitationView {
  guestName: string;
  eventName: string;
  startsAt: string;
  venueName: string;
  venueMapUrl: string | null;
  status: 'VALID' | 'ADMITTED' | 'CLOSED';
  checkedInAt: string | null;
  /** The QR as SVG markup; null once admission has closed. */
  qrSvg: string | null;
}
