import { GuestRsvp } from '../../guests/entities/guest.entity';
import { WhatsappMessageKind as K } from '../entities/whatsapp-message.entity';
import { EligibilityInput, journeySkipReason } from './journey-eligibility';

const H = 60 * 60 * 1000;
const due = new Date('2026-12-20T07:00:00Z');
const base: EligibilityInput = {
  kind: K.FOLLOW_UP_1,
  dueAt: due,
  now: due,
  startsAt: new Date('2026-12-31T17:00:00Z'),
  rsvpClosesAt: new Date('2026-12-29T15:00:00Z'),
  guest: {
    rsvp: GuestRsvp.PENDING,
    rsvpAt: null,
    qrTokenHash: null,
    checkedInAt: null,
  },
  invitationSentAt: new Date(due.getTime() - 3 * 24 * H),
};
const accepted = (hoursBefore: number) => ({
  ...base.guest,
  rsvp: GuestRsvp.ACCEPTED,
  rsvpAt: new Date(due.getTime() - hoursBefore * H),
  qrTokenHash: 'h',
});

describe('journey eligibility (SP-07 rule 2)', () => {
  it('follow-ups go only to guests who have not replied, after their invitation, before the close', () => {
    expect(journeySkipReason(base)).toBeNull();
    expect(journeySkipReason({ ...base, guest: accepted(48) })).toBe(
      'not_pending',
    );
    expect(
      journeySkipReason({
        ...base,
        invitationSentAt: new Date(due.getTime() - 23 * H),
      }),
    ).toBe('too_soon'); // a late guest (AC-J-10)
    expect(journeySkipReason({ ...base, invitationSentAt: null })).toBe(
      'too_soon',
    );
    expect(
      journeySkipReason({ ...base, now: new Date('2026-12-29T15:00:00Z') }),
    ).toBe('rsvp_closed');
  });

  it('reminders skip a guest who accepted less than 24 h before (AC-J-4)', () => {
    const r = { ...base, kind: K.REMINDER_1 };
    expect(journeySkipReason({ ...r, guest: accepted(25) })).toBeNull();
    expect(journeySkipReason({ ...r, guest: accepted(3) })).toBe('too_soon');
    expect(journeySkipReason(r)).toBe('not_accepted');
    expect(
      journeySkipReason({
        ...r,
        guest: { ...accepted(48), qrTokenHash: null },
      }),
    ).toBe('not_accepted');
  });

  it('thank-you only to admitted guests (AC-J-6)', () => {
    const t = { ...base, kind: K.THANK_YOU };
    expect(journeySkipReason(t)).toBe('not_admitted');
    expect(
      journeySkipReason({
        ...t,
        guest: { ...accepted(48), checkedInAt: new Date() },
      }),
    ).toBeNull();
  });
});
