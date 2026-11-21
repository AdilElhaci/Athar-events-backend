import { localParts } from './journey-schedule';

/**
 * Arabic texts and template variables of the guest journey (SP-07, client brief §05–06,
 * `docs/product/journey-templates-ar.md`). Dates are shown in the event's time zone with Latin
 * digits, like the invitation.
 */

const dateFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
const timeFormat = (timeZone: string) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });

export const arabicDate = (at: Date, timeZone: string) =>
  dateFormat(timeZone).format(at);
export const arabicTime = (at: Date, timeZone: string) =>
  timeFormat(timeZone).format(at);
/** «الثلاثاء 29 ديسمبر 2026 الساعة 6:00 م» */
export const arabicDateTime = (at: Date, timeZone: string) =>
  `${arabicDate(at, timeZone)} الساعة ${arabicTime(at, timeZone)}`;

/** M07's first variable: the event is today or tomorrow, in the event's time zone. */
export const todayOrTomorrow = (
  now: Date,
  startsAt: Date,
  timeZone: string,
): string => {
  const a = localParts(now, timeZone);
  const b = localParts(startsAt, timeZone);
  return a.year === b.year && a.month === b.month && a.day === b.day
    ? 'اليوم'
    : 'غدًا';
};

/** The venue line: the maps link when the event has one, else the venue name. */
export const venueLine = (event: {
  venueMapUrl: string | null;
  venueName: string;
}) => event.venueMapUrl || event.venueName;

/** M02 inside the window: the caption of the QR image. */
export const confirmationCaption = (v: {
  eventName: string;
  date: string;
  time: string;
  venue: string;
  qrUrl: string;
}) =>
  `يسعدنا تأكيد حضوركم مناسبة ${v.eventName}\n\n${v.date} | ${v.time}\nالموقع: ${v.venue}\nرمز الدخول الخاص بكم في الصورة أعلاه، ويمكن فتحه من الرابط:\n${v.qrUrl}\n\nنتشرف بلقائكم، ونرجو الاحتفاظ بهذه الرسالة لتسهيل الاستقبال.`;

/** M03, free text inside the window opened by the decline. */
export const APOLOGY_TEXT =
  'كنا نتمنى مشاركتكم هذه المناسبة الجميلة، ولكن نقدّر ظروفكم ونعذركم بكل ود.\n\nشكرًا لتفاعلكم، ونسأل الله أن تجمعنا بكم مناسبات سعيدة قادمة.';
