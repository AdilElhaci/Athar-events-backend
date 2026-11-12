import { ConfigService } from '@nestjs/config';
import { HttpWhatsappClient } from './whatsapp.client';

const config = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

const client = () =>
  new HttpWhatsappClient(
    config({
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
      WHATSAPP_GRAPH_BASE_URL: 'https://graph.test/',
      WHATSAPP_GRAPH_VERSION: 'v23.0',
    }) as never,
  );

const template = {
  name: 'athar_invitation',
  language: 'ar',
  bodyParameters: ['a', 'b', 'c', 'd'],
  quickReplyPayloads: ['RSVP_ACCEPT', 'RSVP_DECLINE'],
};

const respond = (status: number, body: unknown) =>
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));

const networkError = (code: string) =>
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code } }),
    );

describe('HttpWhatsappClient', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds the template payload without the plus sign', async () => {
    const fetchMock = respond(200, { messages: [{ id: 'wamid.1' }] });
    await expect(
      client().sendTemplate('+966512345678', template),
    ).resolves.toEqual({ outcome: 'SENT', messageId: 'wamid.1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.test/v23.0/123456/messages');
    const body = JSON.parse(init!.body as string) as {
      to: string;
      messaging_product: string;
      template: { components: unknown[] };
    };
    expect(body.to).toBe('966512345678');
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: ['a', 'b', 'c', 'd'].map((text) => ({
          type: 'text',
          text,
        })),
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'RSVP_ACCEPT' }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '1',
        parameters: [{ type: 'payload', payload: 'RSVP_DECLINE' }],
      },
    ]);
  });

  it.each([
    [400, { error: { code: 132001 } }, 'FAILED', 'meta_132001'],
    [400, { error: { code: 131056 } }, 'RETRY', 'meta_131056'],
    [429, {}, 'RETRY', 'meta_429'],
    [500, { error: { code: 1 } }, 'UNKNOWN', 'meta_1'],
    [200, {}, 'UNKNOWN', 'no_message_id'],
  ])('HTTP %i %j → %s', async (status, body, outcome, code) => {
    respond(status, body);
    await expect(client().sendTemplate('+9665', template)).resolves.toEqual({
      outcome,
      code,
    });
  });

  it('a refused connection is safe to retry; a timeout is UNKNOWN', async () => {
    networkError('ECONNREFUSED');
    await expect(client().sendTemplate('+9665', template)).resolves.toEqual({
      outcome: 'RETRY',
      code: 'ECONNREFUSED',
    });
    jest.restoreAllMocks();
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    await expect(client().sendTemplate('+9665', template)).resolves.toEqual({
      outcome: 'UNKNOWN',
      code: 'TimeoutError',
    });
  });

  it('without configuration nothing is sent', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const unconfigured = new HttpWhatsappClient(
      config({
        WHATSAPP_GRAPH_BASE_URL: 'https://graph.test',
        WHATSAPP_GRAPH_VERSION: 'v23.0',
      }) as never,
    );
    await expect(unconfigured.sendTemplate('+9665', template)).resolves.toEqual(
      { outcome: 'FAILED', code: 'not_configured' },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('listTemplates', () => {
    const templatesClient = (extra: Record<string, string> = {}) =>
      new HttpWhatsappClient(
        config({
          WHATSAPP_ACCESS_TOKEN: 'token',
          WHATSAPP_WABA_ID: '987654',
          WHATSAPP_GRAPH_BASE_URL: 'https://graph.test',
          WHATSAPP_GRAPH_VERSION: 'v23.0',
          ...extra,
        }) as never,
      );

    it('reads every page and maps body, buttons and rejection', async () => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: '1',
                  name: 'athar_invitation',
                  language: 'ar',
                  status: 'APPROVED',
                  category: 'MARKETING',
                  rejected_reason: 'NONE',
                  components: [
                    { type: 'BODY', text: 'مرحباً {{1}}' },
                    {
                      type: 'BUTTONS',
                      buttons: [{ text: 'قبول' }, { text: 'اعتذار' }],
                    },
                  ],
                },
              ],
              paging: { next: 'https://graph.test/next-page' },
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: '2',
                  name: 'athar_qr',
                  language: 'ar',
                  status: 'REJECTED',
                  category: 'UTILITY',
                  rejected_reason: 'INVALID_FORMAT',
                },
              ],
            }),
            { status: 200 },
          ),
        );
      const result = await templatesClient().listTemplates();
      const firstUrl = new URL(fetchMock.mock.calls[0][0] as string);
      expect(firstUrl.pathname).toBe('/v23.0/987654/message_templates');
      expect(firstUrl.searchParams.get('fields')).toContain('components');
      expect(fetchMock.mock.calls[1][0]).toBe('https://graph.test/next-page');
      expect(result).toEqual({
        ok: true,
        templates: [
          {
            id: '1',
            name: 'athar_invitation',
            language: 'ar',
            category: 'MARKETING',
            status: 'APPROVED',
            rejectedReason: null,
            body: 'مرحباً {{1}}',
            buttons: ['قبول', 'اعتذار'],
          },
          {
            id: '2',
            name: 'athar_qr',
            language: 'ar',
            category: 'UTILITY',
            status: 'REJECTED',
            rejectedReason: 'INVALID_FORMAT',
            body: null,
            buttons: [],
          },
        ],
      });
    });

    it('reports the Meta error code', async () => {
      respond(400, { error: { code: 100 } });
      await expect(templatesClient().listTemplates()).resolves.toEqual({
        ok: false,
        code: 'meta_100',
      });
    });

    it('reports network failures', async () => {
      networkError('ENOTFOUND');
      await expect(templatesClient().listTemplates()).resolves.toEqual({
        ok: false,
        code: 'ENOTFOUND',
      });
    });

    it('calls nothing without a WABA id', async () => {
      const fetchMock = jest.spyOn(global, 'fetch');
      const unconfigured = templatesClient({ WHATSAPP_WABA_ID: '' });
      expect(unconfigured.canListTemplates()).toBe(false);
      await expect(unconfigured.listTemplates()).resolves.toEqual({
        ok: false,
        code: 'not_configured',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('template writes', () => {
    const writer = () =>
      new HttpWhatsappClient(
        config({
          WHATSAPP_ACCESS_TOKEN: 'token',
          WHATSAPP_WABA_ID: '987654',
          WHATSAPP_GRAPH_BASE_URL: 'https://graph.test',
          WHATSAPP_GRAPH_VERSION: 'v23.0',
        }) as never,
      );
    const draft = {
      name: 'event_reminder',
      language: 'ar',
      category: 'UTILITY' as const,
      headerText: 'تذكير',
      body: 'أهلاً {{1}}، نذكّرك بالمناسبة.',
      bodyExamples: ['سارة'],
      footerText: 'أثر',
      quickReplies: ['تم'],
    };

    it('posts the components Meta expects', async () => {
      const fetchMock = respond(200, {
        id: '555',
        status: 'PENDING',
        category: 'UTILITY',
      });
      await expect(writer().createTemplate(draft)).resolves.toEqual({
        ok: true,
        id: '555',
        status: 'PENDING',
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.test/v23.0/987654/message_templates');
      expect(init!.method).toBe('POST');
      expect(JSON.parse(init!.body as string)).toEqual({
        name: 'event_reminder',
        language: 'ar',
        category: 'UTILITY',
        components: [
          { type: 'HEADER', format: 'TEXT', text: 'تذكير' },
          {
            type: 'BODY',
            text: 'أهلاً {{1}}، نذكّرك بالمناسبة.',
            example: { body_text: [['سارة']] },
          },
          { type: 'FOOTER', text: 'أثر' },
          { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'تم' }] },
        ],
      });
    });

    it('classifies an existing name, a rejection with its reason, and 5xx', async () => {
      respond(400, {
        error: {
          code: 100,
          error_subcode: 2388024,
          error_user_msg: 'already exists',
        },
      });
      await expect(writer().createTemplate(draft)).resolves.toMatchObject({
        ok: false,
        reason: 'exists',
      });
      jest.restoreAllMocks();
      respond(400, { error: { code: 100, error_user_msg: 'Bad variable' } });
      await expect(writer().createTemplate(draft)).resolves.toEqual({
        ok: false,
        reason: 'rejected',
        code: 'meta_100',
        userMessage: 'Bad variable',
      });
      jest.restoreAllMocks();
      respond(503, {});
      await expect(writer().createTemplate(draft)).resolves.toMatchObject({
        ok: false,
        reason: 'network',
      });
    });

    it('deletes by Meta id and name', async () => {
      const fetchMock = respond(200, { success: true });
      await expect(
        writer().deleteTemplate('555', 'event_reminder'),
      ).resolves.toMatchObject({ ok: true });
      const [url, init] = fetchMock.mock.calls[0];
      const parsed = new URL(url as string);
      expect(parsed.pathname).toBe('/v23.0/987654/message_templates');
      expect(parsed.searchParams.get('hsm_id')).toBe('555');
      expect(parsed.searchParams.get('name')).toBe('event_reminder');
      expect(init!.method).toBe('DELETE');
    });
  });
});
