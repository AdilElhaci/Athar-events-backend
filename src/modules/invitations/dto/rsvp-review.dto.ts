import { IsIn } from 'class-validator';

export class DecideRsvpReviewDto {
  @IsIn(['ACCEPT', 'DISMISS'])
  decision!: 'ACCEPT' | 'DISMISS';
}

/** One guest's latest accept waiting for an admin (SP-07, D-53). */
export interface RsvpReviewItem {
  inboundId: string;
  guestId: string;
  guestName: string;
  phone: string | null;
  receivedAt: Date;
  /** `CLOSED`: after the RSVP close; `NO_VACANT`: replaced guest, no vacant invitation then. */
  reason: 'CLOSED' | 'NO_VACANT';
  currentRsvp: string;
  replaced: boolean;
}

export interface RsvpReviewsView {
  items: RsvpReviewItem[];
  /** Extra invitations still unused (`extra_margin − used`). */
  vacant: number;
}
