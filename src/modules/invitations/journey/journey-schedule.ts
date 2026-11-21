/**
 * Guest journey timing (SP-07 §4, D-51). Pure functions: every due time is computed from the event
 * and its schedule, in the event's time zone, so the sweeper, the sender's re-check and the
 * schedule preview always agree.
 */

export const JOURNEYS = [7, 21, 40] as const;
export type Journey = (typeof JOURNEYS)[number];

export const isJourney = (value: unknown): value is Journey =>
  JOURNEYS.includes(value as Journey);

export type JourneyStep =
  'FOLLOW_UP_1' | 'FOLLOW_UP_2' | 'REMINDER_1' | 'REMINDER_FINAL' | 'THANK_YOU';

/** D-51. Days after the invitation's send time; days before the event date. */
const OFFSETS: Record<
  Journey,
  { followUp1: number; followUp2: number; reminder1: number }
> = {
  7: { followUp1: 2, followUp2: 4, reminder1: 2 },
  21: { followUp1: 3, followUp2: 7, reminder1: 3 },
  40: { followUp1: 5, followUp2: 12, reminder1: 3 },
};

/** An event starting at this local hour or later is an evening event. */
export const EVENING_FROM_HOUR = 16;
/** Evening events: the final reminder this many hours before the start. */
export const FINAL_REMINDER_HOURS_BEFORE = 5;
/** Morning events: the final reminder at this local hour the day before. */
export const MORNING_FINAL_REMINDER_HOUR = 19;
export const THANK_YOU_HOUR = 12;
/** Default RSVP close: this local hour, this many days before the event date. */
export const RSVP_CLOSE_HOUR = 18;
export const RSVP_CLOSE_DAYS_BEFORE = 2;
/** The proposed invitation time of day. */
export const DEFAULT_SEND_HOUR = 10;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatter = (timeZone: string) => {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
};

/** The wall-clock date and time of an instant in a time zone. */
export const localParts = (instant: Date, timeZone: string): LocalParts => {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(instant))
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
  };
};

/**
 * The instant at a wall-clock time in a time zone. `day` may overflow (e.g. 0 or 32): it is
 * normalised like `Date.UTC`. Two passes settle the zone offset (also across a DST change).
 */
export const zonedInstant = (
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
): Date => {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - seen;
  }
  return new Date(guess);
};

/** The instant on the event date shifted by `days`, at a local hour and minute. */
const onEventDay = (
  startsAt: Date,
  timeZone: string,
  days: number,
  hour: number,
  minute = 0,
) => {
  const d = localParts(startsAt, timeZone);
  return zonedInstant(timeZone, d.year, d.month, d.day + days, hour, minute);
};

export const isEveningEvent = (startsAt: Date, timeZone: string) =>
  localParts(startsAt, timeZone).hour >= EVENING_FROM_HOUR;

/** D-51: invitation day = event date − journey days, at 10:00 by default. */
export const proposedSendAt = (
  startsAt: Date,
  timeZone: string,
  journey: Journey,
): Date => onEventDay(startsAt, timeZone, -journey, DEFAULT_SEND_HOUR);

/** D-51: 18:00 two days before the event date. */
export const defaultRsvpClosesAt = (startsAt: Date, timeZone: string): Date =>
  onEventDay(startsAt, timeZone, -RSVP_CLOSE_DAYS_BEFORE, RSVP_CLOSE_HOUR);

export interface JourneyInput {
  journey: Journey;
  startsAt: Date;
  timeZone: string;
  /** When the invitation goes out; follow-ups count from it. */
  sendAt: Date;
}

/** Due time of every journey step (D-51). */
export const journeyTimeline = (
  input: JourneyInput,
): Record<JourneyStep, Date> => {
  const { journey, startsAt, timeZone, sendAt } = input;
  const o = OFFSETS[journey];
  const send = localParts(sendAt, timeZone);
  return {
    FOLLOW_UP_1: new Date(sendAt.getTime() + o.followUp1 * DAY_MS),
    FOLLOW_UP_2: new Date(sendAt.getTime() + o.followUp2 * DAY_MS),
    REMINDER_1: onEventDay(
      startsAt,
      timeZone,
      -o.reminder1,
      send.hour,
      send.minute,
    ),
    REMINDER_FINAL: isEveningEvent(startsAt, timeZone)
      ? new Date(startsAt.getTime() - FINAL_REMINDER_HOURS_BEFORE * HOUR_MS)
      : onEventDay(startsAt, timeZone, -1, MORNING_FINAL_REMINDER_HOUR),
    THANK_YOU: onEventDay(startsAt, timeZone, 1, THANK_YOU_HOUR),
  };
};

/**
 * Steps that will actually run for this schedule: follow-ups only before the RSVP close and
 * reminders only before the event. A step whose time passes before it is created is skipped by
 * the sweeper (no retroactive sends), so this is a preview, not a promise.
 */
export const plannedSteps = (
  input: JourneyInput & { rsvpClosesAt: Date },
): { step: JourneyStep; dueAt: Date }[] => {
  const timeline = journeyTimeline(input);
  return (Object.keys(timeline) as JourneyStep[])
    .map((step) => ({ step, dueAt: timeline[step] }))
    .filter(({ step, dueAt }) => {
      if (dueAt <= input.sendAt) return false;
      if (step === 'FOLLOW_UP_1' || step === 'FOLLOW_UP_2')
        return dueAt < input.rsvpClosesAt;
      if (step === 'THANK_YOU') return true;
      return dueAt < input.startsAt;
    })
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
};
