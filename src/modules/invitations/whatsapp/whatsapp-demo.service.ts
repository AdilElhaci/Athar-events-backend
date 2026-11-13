import { randomBytes, randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  badRequest,
  notFound,
  serviceUnavailable,
  tooManyRequests,
} from '../../../shared/exceptions/app.exception';
import {
  RateLimitService,
  REDIS,
} from '../../auth/services/rate-limit.service';
import { sha256 } from '../../auth/utils/crypto.util';
import { renderQrPng } from '../../checkin/qr-token';
import { normalizeSaudiMobile } from '../../users/utils/phone';
import { renderInvitation } from '../invitation-template';
import { WhatsappClient } from './whatsapp.client';

/**
 * Where a demo stands. WAITING: the visitor has not sent the code yet. INVITED: the sample
 * invitation was sent. ACCEPTED: the sample pass was sent. CHECKED_IN: the door scan was played.
 */
export type DemoState =
  'WAITING' | 'INVITED' | 'ACCEPTED' | 'DECLINED' | 'CHECKED_IN' | 'FAILED';

export interface DemoStart {
  sessionId: string;
  /** The number to write to, digits only (for a wa.me link). */
  whatsappNumber: string;
  /** The exact text the visitor sends, code included. */
  text: string;
  expiresAt: string;
}

export interface DemoStatus {
  state: DemoState;
  expiresAt: string;
}

/** One inbound message the webhook passes on after it has been recorded (deduplicated). */
export interface DemoInbound {
  fromPhone: string;
  text?: string;
  buttonId?: string;
}

export const DEMO_ACCEPT = 'DEMO_ACCEPT';
export const DEMO_DECLINE = 'DEMO_DECLINE';

const SESSION_TTL_S = 30 * 60;
const SESSION_ID = /^[\w-]{24}$/;
const STARTS_PER_IP_PER_HOUR = 5;
const STARTS_PER_PHONE_PER_DAY = 3;
const TEXT_PREFIX = 'تجربة أثر';

/** The sample occasion the demo plays; matches the invitation shown on the landing page. */
const SAMPLE = {
  eventName: 'حفل زفاف نورة وعبدالله',
  dateText: 'الخميس 12 نوفمبر 2026، 8:00 مساءً',
  venue: 'قاعة الياسمين، الرياض',
};
const GUEST_NAME = 'ضيفنا العزيز';

/** Sets the state only when the current one is among the allowed ones; returns 1 when it did. */
const TRANSITION_SCRIPT = `
local current = redis.call('HGET', KEYS[1], 'state')
if not current then return 0 end
for i = 2, #ARGV do
  if current == ARGV[i] then
    redis.call('HSET', KEYS[1], 'state', ARGV[1])
    return 1
  end
end
return 0`;

const asciiDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

/**
 * Public "try the invitation on WhatsApp" demo (2026-11-14). The visitor proves the number is
 * theirs by writing to us first (a code shown on the page), so nothing is ever sent to a number
 * whose owner did not ask; every reply is a free-form message inside the 24 h service window, so
 * no template is needed. Sessions live in Redis for 30 minutes; nothing is stored in the database
 * beyond the inbound log every webhook message gets. Ambiguous sends end the demo (FAILED) and are
 * never retried. Phones and codes are never logged.
 */
@Injectable()
export class WhatsappDemoService {
  private readonly logger = new Logger(WhatsappDemoService.name);
  private readonly number: string;
  private readonly dailyLimit: number;
  private readonly appOrigin: string;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rateLimits: RateLimitService,
    private readonly client: WhatsappClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.number = config.get('WHATSAPP_DEMO_NUMBER', { infer: true }) ?? '';
    this.dailyLimit = config.get('WHATSAPP_DEMO_DAILY_LIMIT', { infer: true });
    this.appOrigin = config
      .get('APP_ORIGIN', { infer: true })
      .replace(/\/+$/, '');
  }

  private enabled(): boolean {
    return this.number.length > 0 && this.client.isConfigured();
  }

  async start(rawPhone: string, ip: string | null): Promise<DemoStart> {
    if (!this.enabled()) throw serviceUnavailable('demo.unavailable');
    const digits = normalizeSaudiMobile(rawPhone);
    if (!digits) throw badRequest('user.phone_invalid');
    const phone = `+${digits}`;

    if (
      !(await this.rateLimits.hit(
        'demo:ip',
        ip ?? 'unknown',
        STARTS_PER_IP_PER_HOUR,
        3600,
      )) ||
      !(await this.rateLimits.hit(
        'demo:phone',
        phone,
        STARTS_PER_PHONE_PER_DAY,
        86_400,
      ))
    )
      throw tooManyRequests();

    const sessionId = randomBytes(18).toString('base64url');
    const code = String(randomInt(100_000, 1_000_000));
    const expiresAt = new Date(Date.now() + SESSION_TTL_S * 1000);
    await this.redis
      .multi()
      .hset(this.sessionKey(sessionId), {
        phone,
        code,
        state: 'WAITING',
        expiresAt: expiresAt.toISOString(),
      })
      .expire(this.sessionKey(sessionId), SESSION_TTL_S)
      // A newer demo for the same number replaces the older one.
      .set(this.phoneKey(phone), sessionId, 'EX', SESSION_TTL_S)
      .exec();

    return {
      sessionId,
      whatsappNumber: this.number,
      text: `${TEXT_PREFIX} ${code}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async status(sessionId: string): Promise<DemoStatus> {
    const session = await this.session(sessionId);
    return { state: session.state, expiresAt: session.expiresAt };
  }

  /** The visitor pressed "scan at the door" on the page: plays the welcome message. */
  async checkIn(sessionId: string): Promise<DemoStatus> {
    const session = await this.session(sessionId);
    if (session.state === 'CHECKED_IN')
      return { state: session.state, expiresAt: session.expiresAt };
    if (!(await this.transition(sessionId, 'CHECKED_IN', ['ACCEPTED'])))
      throw badRequest('demo.not_ready');
    await this.send(
      sessionId,
      this.client.sendText(
        session.phone,
        [
          `أهلًا بك في ${SAMPLE.eventName} 🌿`,
          'تم تسجيل دخولك، ونتمنى لك وقتًا سعيدًا.',
          '',
          'بهذا تنتهي التجربة: هكذا يعيش ضيوفك مناسبتك مع أثر، من الدعوة إلى الاستقبال.',
          `ابدأ مناسبتك: ${this.appOrigin}/packages`,
        ].join('\n'),
      ),
    );
    return this.status(sessionId);
  }

  /** Called by the webhook after the message was recorded; never throws. */
  async onInbound(inbound: DemoInbound): Promise<void> {
    try {
      const sessionId = await this.redis.get(this.phoneKey(inbound.fromPhone));
      if (!sessionId) return;
      const session = await this.session(sessionId).catch(() => null);
      if (!session) return;

      if (inbound.buttonId === DEMO_ACCEPT)
        return await this.accept(sessionId, session.phone);
      if (inbound.buttonId === DEMO_DECLINE)
        return await this.decline(sessionId, session.phone);

      const code = /\d{6}/.exec(asciiDigits(inbound.text ?? ''))?.[0];
      if (session.state === 'WAITING' && code === session.code)
        await this.invite(sessionId, session.phone);
    } catch (error) {
      this.logger.warn(`Demo inbound failed: ${(error as Error).name}`);
    }
  }

  private async invite(sessionId: string, phone: string): Promise<void> {
    if (!(await this.transition(sessionId, 'INVITED', ['WAITING']))) return;
    if (
      this.dailyLimit > 0 &&
      !(await this.rateLimits.hit('demo:day', 'all', this.dailyLimit, 86_400))
    ) {
      await this.transition(sessionId, 'FAILED', ['INVITED']);
      await this.client.sendText(
        phone,
        'شكرًا لاهتمامك بأثر! وصلت التجارب اليوم حدّها، جرّبها مرة ثانية بكرة.',
      );
      return;
    }
    await this.send(
      sessionId,
      this.client.sendButtons(phone, {
        header: 'دعوة زفاف',
        body: renderInvitation(SAMPLE, GUEST_NAME),
        footer: 'دعوة تجريبية من أثر إيفنتس',
        buttons: [
          { id: DEMO_ACCEPT, title: 'سأحضر' },
          { id: DEMO_DECLINE, title: 'أعتذر' },
        ],
      }),
    );
  }

  private async accept(sessionId: string, phone: string): Promise<void> {
    if (
      !(await this.transition(sessionId, 'ACCEPTED', ['INVITED', 'DECLINED']))
    )
      return;
    // A harmless code: it opens the demo page, never a real guest pass.
    const upload = await this.client.uploadPng(
      await renderQrPng(`${this.appOrigin}/try-whatsapp`),
    );
    if (!upload.ok) {
      await this.transition(sessionId, 'FAILED', ['ACCEPTED']);
      this.logger.warn(`Demo pass upload failed: ${upload.code}`);
      return;
    }
    await this.send(
      sessionId,
      this.client.sendImage(
        phone,
        upload.mediaId,
        [
          `رمز دخولك إلى ${SAMPLE.eventName}.`,
          'يُرجى إبرازه عند الوصول.',
          '',
          'ارجع لصفحة التجربة واضغط «امسح الرمز عند الباب» لترى لحظة الاستقبال.',
        ].join('\n'),
      ),
    );
  }

  private async decline(sessionId: string, phone: string): Promise<void> {
    if (!(await this.transition(sessionId, 'DECLINED', ['INVITED']))) return;
    await this.send(
      sessionId,
      this.client.sendText(
        phone,
        'شكرًا لردّك، ووصل اعتذارك لصاحب المناسبة.\nتبغى تشوف رحلة الحضور؟ اضغط «سأحضر» في الدعوة.',
      ),
    );
  }

  /** Sends once; anything but SENT ends the demo (an ambiguous send is never repeated). */
  private async send(
    sessionId: string,
    sending: Promise<{ outcome: string; code?: string }>,
  ): Promise<void> {
    const result = await sending;
    if (result.outcome === 'SENT') return;
    this.logger.warn(`Demo send ${result.outcome}: ${result.code ?? ''}`);
    await this.redis.hset(this.sessionKey(sessionId), 'state', 'FAILED');
  }

  private async session(sessionId: string): Promise<{
    phone: string;
    code: string;
    state: DemoState;
    expiresAt: string;
  }> {
    if (!SESSION_ID.test(sessionId)) throw notFound('demo.expired');
    const data = await this.redis.hgetall(this.sessionKey(sessionId));
    if (!data.state) throw notFound('demo.expired');
    return {
      phone: data.phone,
      code: data.code,
      state: data.state as DemoState,
      expiresAt: data.expiresAt,
    };
  }

  private async transition(
    sessionId: string,
    to: DemoState,
    from: DemoState[],
  ): Promise<boolean> {
    const done = (await this.redis.eval(
      TRANSITION_SCRIPT,
      1,
      this.sessionKey(sessionId),
      to,
      ...from,
    )) as number;
    return done === 1;
  }

  private sessionKey(sessionId: string): string {
    return `demo:s:${sessionId}`;
  }

  private phoneKey(phone: string): string {
    return `demo:p:${sha256(phone)}`;
  }
}
