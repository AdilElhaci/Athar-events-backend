import {
  defaultRsvpClosesAt,
  isEveningEvent,
  journeyTimeline,
  plannedSteps,
  proposedSendAt,
  zonedInstant,
} from './journey-schedule';

const RIYADH = 'Asia/Riyadh';
const iso = (d: Date) => d.toISOString();

describe('journey schedule (D-51)', () => {
  it('converts wall-clock times in the event time zone, including day overflow and DST', () => {
    expect(iso(zonedInstant(RIYADH, 2026, 12, 31, 20))).toBe(
      '2026-12-31T17:00:00.000Z',
    );
    expect(iso(zonedInstant(RIYADH, 2026, 12, 32, 12))).toBe(
      '2027-01-01T09:00:00.000Z',
    );
    expect(iso(zonedInstant(RIYADH, 2027, 1, 20 - 40, 10))).toBe(
      '2026-12-11T07:00:00.000Z',
    );
    // British Summer Time starts on 2026-03-29.
    expect(iso(zonedInstant('Europe/London', 2026, 3, 29, 12))).toBe(
      '2026-03-29T11:00:00.000Z',
    );
  });

  it('21-day evening event: every step', () => {
    const startsAt = new Date('2026-12-31T17:00:00Z'); // 20:00 Riyadh
    const sendAt = proposedSendAt(startsAt, RIYADH, 21);
    expect(iso(sendAt)).toBe('2026-12-10T07:00:00.000Z'); // 10:00 on D-21
    const t = journeyTimeline({
      journey: 21,
      startsAt,
      timeZone: RIYADH,
      sendAt,
    });
    expect(iso(t.FOLLOW_UP_1)).toBe('2026-12-13T07:00:00.000Z'); // +3 days
    expect(iso(t.FOLLOW_UP_2)).toBe('2026-12-17T07:00:00.000Z'); // +7 days
    expect(iso(t.REMINDER_1)).toBe('2026-12-28T07:00:00.000Z'); // D-3 at the send time
    expect(iso(t.REMINDER_FINAL)).toBe('2026-12-31T12:00:00.000Z'); // 5 h before
    expect(iso(t.THANK_YOU)).toBe('2027-01-01T09:00:00.000Z'); // 12:00 the day after
    expect(iso(defaultRsvpClosesAt(startsAt, RIYADH))).toBe(
      '2026-12-29T15:00:00.000Z', // 18:00 on D-2
    );
  });

  it('7-day and 40-day offsets', () => {
    const startsAt = new Date('2026-12-10T18:00:00Z'); // 21:00 Riyadh
    const sendAt = proposedSendAt(startsAt, RIYADH, 7);
    const t7 = journeyTimeline({
      journey: 7,
      startsAt,
      timeZone: RIYADH,
      sendAt,
    });
    expect(iso(sendAt)).toBe('2026-12-03T07:00:00.000Z');
    expect(iso(t7.FOLLOW_UP_1)).toBe('2026-12-05T07:00:00.000Z');
    expect(iso(t7.FOLLOW_UP_2)).toBe('2026-12-07T07:00:00.000Z');
    expect(iso(t7.REMINDER_1)).toBe('2026-12-08T07:00:00.000Z'); // D-2

    const late = new Date('2027-01-20T17:00:00Z');
    const send40 = proposedSendAt(late, RIYADH, 40);
    const t40 = journeyTimeline({
      journey: 40,
      startsAt: late,
      timeZone: RIYADH,
      sendAt: send40,
    });
    expect(iso(send40)).toBe('2026-12-11T07:00:00.000Z');
    expect(iso(t40.FOLLOW_UP_1)).toBe('2026-12-16T07:00:00.000Z');
    expect(iso(t40.FOLLOW_UP_2)).toBe('2026-12-23T07:00:00.000Z');
    expect(iso(t40.REMINDER_1)).toBe('2027-01-17T07:00:00.000Z'); // D-3
  });

  it('morning and evening at the 16:00 boundary', () => {
    const morning = new Date('2026-12-31T08:00:00Z'); // 11:00 Riyadh
    const boundary = new Date('2026-12-31T13:00:00Z'); // 16:00 Riyadh
    const almost = new Date('2026-12-31T12:59:00Z'); // 15:59 Riyadh
    expect(isEveningEvent(morning, RIYADH)).toBe(false);
    expect(isEveningEvent(almost, RIYADH)).toBe(false);
    expect(isEveningEvent(boundary, RIYADH)).toBe(true);

    const sendAt = proposedSendAt(morning, RIYADH, 7);
    const t = journeyTimeline({
      journey: 7,
      startsAt: morning,
      timeZone: RIYADH,
      sendAt,
    });
    expect(iso(t.REMINDER_FINAL)).toBe('2026-12-30T16:00:00.000Z'); // 19:00 the day before

    const e = journeyTimeline({
      journey: 7,
      startsAt: boundary,
      timeZone: RIYADH,
      sendAt,
    });
    expect(iso(e.REMINDER_FINAL)).toBe('2026-12-31T08:00:00.000Z'); // 11:00, 5 h before
  });

  it('plans follow-ups only before the RSVP close', () => {
    const startsAt = new Date('2026-12-10T18:00:00Z');
    // The invitation goes out late, on D-5: follow-up 2 (+4 days) falls after the close.
    const sendAt = new Date('2026-12-05T07:00:00Z');
    const steps = plannedSteps({
      journey: 7,
      startsAt,
      timeZone: RIYADH,
      sendAt,
      rsvpClosesAt: defaultRsvpClosesAt(startsAt, RIYADH),
    }).map((s) => s.step);
    expect(steps).toEqual([
      'FOLLOW_UP_1',
      'REMINDER_1',
      'REMINDER_FINAL',
      'THANK_YOU',
    ]);
  });
});
