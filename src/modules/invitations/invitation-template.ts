import { createHash } from 'node:crypto';
import type { InvitationVariables } from './entities/invitation-content.entity';

export const TEMPLATE_LANGUAGE = 'ar';

/**
 * The invitation wording (ADR-0003: fixed per template, variables only). This text must match
 * the body submitted to Meta word for word: {{1}} guest name, {{2}} event name, {{3}} date and
 * time, {{4}} venue. Draft until Meta approves it (OQ-14).
 */
export const INVITATION_BODY = [
  'حياك الله {{1}}،',
  'يسعدنا دعوتك لحضور {{2}}.',
  '📅 {{3}}',
  '📍 {{4}}',
  'نتشرف بتأكيد حضورك.',
].join('\n');

/** Quick-reply buttons with payloads RSVP_ACCEPT / RSVP_DECLINE. */
export const INVITATION_BUTTONS = ['سأحضر', 'أعتذر'] as const;

/** Shown to the owner in place of each guest's name. */
export const SAMPLE_GUEST_NAME = 'محمد العتيبي';

export const renderInvitation = (
  variables: InvitationVariables,
  guestName = SAMPLE_GUEST_NAME,
): string =>
  // Replacer functions: a "$&" typed into a variable must stay literal text.
  INVITATION_BODY.replace('{{1}}', () => guestName)
    .replace('{{2}}', () => variables.eventName)
    .replace('{{3}}', () => variables.dateText)
    .replace('{{4}}', () => variables.venue);

export const contentHash = (
  templateName: string,
  variables: InvitationVariables,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        templateName,
        TEMPLATE_LANGUAGE,
        variables.eventName,
        variables.dateText,
        variables.venue,
      ]),
    )
    .digest('hex');

const dateText = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
  timeZone: 'Asia/Riyadh',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Suggested variables from the event details; the admin can reword them. */
export const suggestVariables = (event: {
  name: string;
  startsAt: Date;
  venueName: string;
}): InvitationVariables => ({
  eventName: event.name,
  dateText: dateText.format(event.startsAt),
  venue: event.venueName,
});
