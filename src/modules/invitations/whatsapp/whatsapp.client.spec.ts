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
});
