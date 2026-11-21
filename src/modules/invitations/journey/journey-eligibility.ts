import { GuestRsvp } from '../../guests/entities/guest.entity';
import { WhatsappMessageKind } from '../entities/whatsapp-message.entity';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface EligibilityInput {
  kind: WhatsappMessageKind;
  dueAt: Date;
  now: Date;
  startsAt: Date;
  rsvpClosesAt: Date | null;
  guest: {
    rsvp: GuestRsvp;
    rsvpAt: Date | null;
    qrTokenHash: string | null;
    checkedInAt: Date | null;
  };
  /** When the guest's invitation was accepted by WhatsApp; null if never (or it failed). */
  invitationSentAt: Date | null;
}

/**
 * SP-07 rule 2: whether a journey message is still due for this guest. Null = send; otherwise the
 * reason code kept on the cancelled intent. The sweeper applies the same rules in SQL when it
 * creates the intents; the sender calls this after the claim, because the guest may have replied
 * in between.
 */
export function journeySkipReason(input: EligibilityInput): string | null {
  const { kind, dueAt, guest } = input;
  switch (kind) {
    case WhatsappMessageKind.FOLLOW_UP_1:
    case WhatsappMessageKind.FOLLOW_UP_2:
      if (guest.rsvp !== GuestRsvp.PENDING) return 'not_pending';
      if (input.rsvpClosesAt && input.now >= input.rsvpClosesAt)
        return 'rsvp_closed';
      if (
        !input.invitationSentAt ||
        input.invitationSentAt.getTime() > dueAt.getTime() - DAY_MS
      )
        return 'too_soon';
      return null;
    case WhatsappMessageKind.REMINDER_1:
    case WhatsappMessageKind.REMINDER_FINAL:
      if (guest.rsvp !== GuestRsvp.ACCEPTED || !guest.qrTokenHash)
        return 'not_accepted';
      if (!guest.rsvpAt || guest.rsvpAt.getTime() > dueAt.getTime() - DAY_MS)
        return 'too_soon';
      if (input.now >= input.startsAt) return 'event_started';
      return null;
    case WhatsappMessageKind.THANK_YOU:
      return guest.checkedInAt ? null : 'not_admitted';
    default:
      return 'unsupported_kind';
  }
}
