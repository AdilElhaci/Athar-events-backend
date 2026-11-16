import { inboxSendable, variableCount } from './inbox.service';
import type { MessageTemplate } from './whatsapp/whatsapp.client';

const template = (over: Partial<MessageTemplate> = {}): MessageTemplate => ({
  id: '1',
  name: 'event_reminder',
  language: 'ar',
  category: 'UTILITY',
  status: 'APPROVED',
  rejectedReason: null,
  body: 'مرحباً {{1}}، موعدنا {{2}}.',
  buttons: [],
  headerFormat: null,
  headerText: null,
  footer: null,
  buttonTypes: [],
  dynamicUrlButton: false,
  ...over,
});

describe('D-47 inbox templates', () => {
  it('counts body variables by the highest number', () => {
    expect(variableCount('مرحباً {{1}} و {{ 2 }} و {{1}}')).toBe(2);
    expect(variableCount('بدون متغيرات')).toBe(0);
    expect(variableCount(null)).toBe(0);
  });

  it('accepts approved utility and marketing templates with body values only', () => {
    expect(inboxSendable(template(), 'athar_invitation')).toBe(true);
    expect(
      inboxSendable(
        template({
          category: 'MARKETING',
          headerFormat: 'TEXT',
          headerText: 'عرض',
          buttonTypes: ['QUICK_REPLY', 'URL', 'PHONE_NUMBER'],
        }),
        'athar_invitation',
      ),
    ).toBe(true);
  });

  it.each<[string, Partial<MessageTemplate>]>([
    ['not approved', { status: 'PAUSED' }],
    ['authentication', { category: 'AUTHENTICATION' }],
    ['the invitation template', { name: 'athar_invitation' }],
    ['a media header', { headerFormat: 'IMAGE' }],
    ['a header variable', { headerFormat: 'TEXT', headerText: 'أهلاً {{1}}' }],
    ['a dynamic URL', { buttonTypes: ['URL'], dynamicUrlButton: true }],
    ['a copy-code button', { buttonTypes: ['COPY_CODE'] }],
    ['no body', { body: null }],
  ])('refuses %s', (_, over) => {
    expect(inboxSendable(template(over), 'athar_invitation')).toBe(false);
  });
});
