import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { DataSource, In, IsNull, MoreThan, Not } from 'typeorm';
import type { EnvironmentVariables } from '../../../config/env.validation';
import {
  RateLimitService,
  REDIS,
} from '../../auth/services/rate-limit.service';
import { sha256 } from '../../auth/utils/crypto.util';
import { Event, EventStatus } from '../../events/entities/event.entity';
import { Guest, GuestRsvp } from '../../guests/entities/guest.entity';
import { InvitationContent } from '../entities/invitation-content.entity';
import { WhatsappInbound } from '../entities/whatsapp-inbound.entity';
import {
  WhatsappMessage,
  WhatsappMessageKind,
  WhatsappMessageState,
} from '../entities/whatsapp-message.entity';
import {
  WhatsappReply,
  WhatsappReplySource,
} from '../entities/whatsapp-reply.entity';
import { WhatsappDemoService } from './whatsapp-demo.service';
import { qrKey, WhatsappSenderService } from './whatsapp-sender.service';
import { ButtonsMessage, SendOutcome, WhatsappClient } from './whatsapp.client';

/** One inbound message the webhook passes on after it has been recorded (deduplicated). */
export interface BotInbound {
  inboundId: string;
  fromPhone: string;
  /** `text`, a reply button of ours (`button`), or media and the like (`other`). */
  kind: 'text' | 'button' | 'other';
  buttonId?: string;
}

export const BOT_DETAILS = 'BOT_DETAILS';
export const BOT_PASS = 'BOT_PASS';
export const BOT_ABOUT = 'BOT_ABOUT';
export const BOT_PACKAGES = 'BOT_PACKAGES';
export const BOT_HUMAN = 'BOT_HUMAN';

/** The menu is not sent twice to a number within this many seconds. */
const MENU_COOLDOWN_S = 60;
/** Bot answers per number in any rolling 24 h; bounds a loop with another bot. */
const ANSWERS_PER_PHONE_PER_DAY = 30;
/** Passes the bot re-sends per guest in any rolling 24 h. */
const PASSES_PER_GUEST_PER_DAY = 2;

const HUMAN_BUTTON = { id: BOT_HUMAN, title: 'التواصل مع الفريق' };

/** The upcoming occasion a number is a guest of; null for anyone else. */
interface GuestContext {
  guest: Guest;
  event: Event;
  content: InvitationContent | null;
}

/**
 * D-49 WhatsApp auto-reply menu. Answers what a number writes with a fixed menu of reply buttons:
 * for a guest of an upcoming occasion (an invitation was sent to it, admission not yet closed) the
 * occasion's details, a new pass for an accepted guest, or the team; for anyone else what Athar
 * is, the packages, or the team. Every answer is a free-form message to a number that just wrote
 * (24 h service window), sent once and never retried. The bot stays silent while a public demo
 * runs on the number, after a handoff and after an admin reply (`WHATSAPP_BOT_HANDOFF_HOURS`).
 * Answers are recorded as `BOT` replies for the inbox. Phones and texts are never logged.
 */
@Injectable()
export class WhatsappBotService {
  private readonly logger = new Logger(WhatsappBotService.name);
  private readonly enabled: boolean;
  private readonly handoffHours: number;
  private readonly appOrigin: string;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly rateLimits: RateLimitService,
    private readonly client: WhatsappClient,
    private readonly sender: WhatsappSenderService,
    private readonly demo: WhatsappDemoService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.enabled = config.get('WHATSAPP_BOT_ENABLED', { infer: true });
    this.handoffHours = config.get('WHATSAPP_BOT_HANDOFF_HOURS', {
      infer: true,
    });
    this.appOrigin = config
      .get('APP_ORIGIN', { infer: true })
      .replace(/\/+$/, '');
  }

  /** Called by the webhook after the message was recorded; never throws. */
  async onInbound(inbound: BotInbound): Promise<void> {
    if (!this.enabled || !this.client.isConfigured()) return;
    if (inbound.kind === 'button' && !inbound.buttonId?.startsWith('BOT_'))
      return; // another flow's button (the public demo)
    try {
      const phone = inbound.fromPhone;
      if (await this.demo.hasSession(phone)) return;
      if (await this.silent(phone)) return;
      if (inbound.kind !== 'button' && !(await this.menuCooldown(phone)))
        return;
      if (
        !(await this.rateLimits.hit(
          'bot:phone',
          phone,
          ANSWERS_PER_PHONE_PER_DAY,
          86_400,
        ))
      )
        return;

      const context = await this.guestContext(phone);
      const answered = await this.answer(inbound, phone, context);
      // A message the bot answered needs no human; a handoff stays unread for the inbox.
      if (answered) await this.markSeen(inbound.inboundId);
    } catch (error) {
      this.logger.warn(`Bot inbound failed: ${(error as Error).name}`);
    }
  }

  /** Returns true when the bot fully answered the message. */
  private async answer(
    inbound: BotInbound,
    phone: string,
    context: GuestContext | null,
  ): Promise<boolean> {
    switch (inbound.kind === 'button' ? inbound.buttonId : undefined) {
      case BOT_HUMAN:
        await this.handoff(phone, context);
        return false;
      case BOT_ABOUT:
        return this.sendText(phone, context, this.aboutText());
      case BOT_PACKAGES:
        return this.sendText(phone, context, this.packagesText());
      case BOT_DETAILS:
        if (context)
          return this.sendText(phone, context, this.detailsText(context));
        break;
      case BOT_PASS:
        if (context && this.canResendPass(context))
          return this.resendPass(phone, context);
        break;
    }
    return this.sendMenu(phone, context);
  }

  private sendMenu(
    phone: string,
    context: GuestContext | null,
  ): Promise<boolean> {
    if (!context)
      return this.sendButtons(phone, null, {
        body: [
          'أهلًا بك في أثر إيفنتس 🌿',
          'دعوات مناسبتك على واتساب، من الدعوة إلى الاستقبال.',
          '',
          'اختر ما يناسبك:',
        ].join('\n'),
        buttons: [
          { id: BOT_ABOUT, title: 'عن أثر' },
          { id: BOT_PACKAGES, title: 'الباقات والأسعار' },
          HUMAN_BUTTON,
        ],
      });
    return this.sendButtons(phone, context, {
      body: [
        `أهلًا ${context.guest.name} 🌿`,
        `كيف نقدر نخدمك بخصوص ${this.eventName(context)}؟`,
      ].join('\n'),
      footer: 'أثر إيفنتس',
      buttons: [
        { id: BOT_DETAILS, title: 'تفاصيل المناسبة' },
        ...(this.canResendPass(context)
          ? [{ id: BOT_PASS, title: 'إعادة إرسال البطاقة' }]
          : []),
        HUMAN_BUTTON,
      ],
    });
  }

  private async handoff(
    phone: string,
    context: GuestContext | null,
  ): Promise<void> {
    await this.redis.set(this.handoffKey(phone), '1', 'EX', this.ttl());
    await this.sendText(
      phone,
      context,
      'وصل طلبك لفريق أثر، وبيردّون عليك هنا في أقرب وقت 🌿',
    );
  }

  /**
   * A new pass for an accepted guest, through the regular QR sender: a new version, so a new token
   * (only its hash is stored, so the earlier image cannot be sent again) and the earlier pass stops
   * admitting. Nothing new while a pass is still on its way. Before the event starts only: the
   * sender never sends after the start.
   */
  private async resendPass(
    phone: string,
    context: GuestContext,
  ): Promise<boolean> {
    if (
      !(await this.rateLimits.hit(
        'bot:pass',
        context.guest.id,
        PASSES_PER_GUEST_PER_DAY,
        86_400,
      ))
    )
      return this.sendText(
        phone,
        context,
        'أرسلنا لك بطاقة الدخول قبل قليل، تجدها أعلى المحادثة.\nإذا ما وصلتك، اختر «التواصل مع الفريق».',
      );

    const intentId = await this.db.transaction(async (manager) => {
      const guest = await manager
        .getRepository(Guest)
        .createQueryBuilder('g')
        .setLock('pessimistic_write')
        .where('g.id = :id', { id: context.guest.id })
        .getOne();
      if (!guest || guest.deletedAt || guest.rsvp !== GuestRsvp.ACCEPTED)
        return null;
      const latest = await manager.findOne(WhatsappMessage, {
        where: { guestId: guest.id, kind: WhatsappMessageKind.QR },
        order: { qrVersion: 'DESC' },
      });
      if (
        latest?.state === WhatsappMessageState.QUEUED ||
        latest?.state === WhatsappMessageState.SENDING
      )
        return latest.id;
      const qrVersion = Math.max(guest.qrVersion, latest?.qrVersion ?? 0) + 1;
      await manager
        .createQueryBuilder()
        .insert()
        .into(WhatsappMessage)
        .values({
          eventId: guest.eventId,
          guestId: guest.id,
          kind: WhatsappMessageKind.QR,
          logicalKey: qrKey(guest.id, qrVersion),
          qrVersion,
        })
        .orIgnore()
        .execute();
      const intent = await manager.findOneByOrFail(WhatsappMessage, {
        logicalKey: qrKey(guest.id, qrVersion),
      });
      return intent.id;
    });
    // No longer an accepted guest: the menu as it now stands.
    if (!intentId) return this.sendMenu(phone, await this.guestContext(phone));

    await this.sender.process(intentId);
    const { state } = await this.db
      .getRepository(WhatsappMessage)
      .findOneByOrFail({ id: intentId });
    // Sent, or on its way (being sent, or queued for the sweeper's retry).
    if (
      state === WhatsappMessageState.SENT ||
      state === WhatsappMessageState.SENDING ||
      state === WhatsappMessageState.QUEUED
    )
      return true;
    // Failed, cancelled or unclear: never sent again automatically; a human takes it.
    await this.handoff(phone, context);
    return false;
  }

  private canResendPass(context: GuestContext): boolean {
    return (
      context.guest.rsvp === GuestRsvp.ACCEPTED &&
      context.event.startsAt.getTime() > Date.now()
    );
  }

  private sendText(
    phone: string,
    context: GuestContext | null,
    body: string,
  ): Promise<boolean> {
    return this.record(phone, context, body, () =>
      this.client.sendText(phone, body),
    );
  }

  private sendButtons(
    phone: string,
    context: GuestContext | null,
    message: ButtonsMessage,
  ): Promise<boolean> {
    const shown = `${message.body}\n\n${message.buttons.map((b) => `[${b.title}]`).join(' ')}`;
    return this.record(phone, context, shown, () =>
      this.client.sendButtons(phone, message),
    );
  }

  /** Sends once and records the answer as a `BOT` reply; true when Meta accepted it. */
  private async record(
    phone: string,
    context: GuestContext | null,
    body: string,
    send: () => Promise<SendOutcome>,
  ): Promise<boolean> {
    const repo = this.db.getRepository(WhatsappReply);
    const inserted = await repo
      .createQueryBuilder()
      .insert()
      .values({
        source: WhatsappReplySource.BOT,
        sentByUserId: null,
        requestId: randomUUID(),
        eventId: context?.event.id ?? null,
        guestId: context?.guest.id ?? null,
        toPhone: phone,
        body: body.slice(0, 4096),
      })
      .returning(['id'])
      .execute();
    const replyId = (inserted.raw as Array<{ id: string }>)[0].id;

    const result = await send();
    const state =
      result.outcome === 'SENT'
        ? WhatsappMessageState.SENT
        : result.outcome === 'UNKNOWN'
          ? WhatsappMessageState.UNKNOWN
          : WhatsappMessageState.FAILED;
    await repo.update(replyId, {
      state,
      ...(result.outcome === 'SENT'
        ? { providerMessageId: result.messageId, sentAt: new Date() }
        : { errorCode: result.code.slice(0, 60) }),
      ...(state === WhatsappMessageState.FAILED && { failedAt: new Date() }),
    });
    if (result.outcome !== 'SENT')
      this.logger.warn(
        `Bot reply ${replyId} ${result.outcome}: ${result.code}`,
      );
    return result.outcome === 'SENT';
  }

  /** Silent after a handoff, or while an admin answered the number within the handoff hours. */
  private async silent(phone: string): Promise<boolean> {
    if (await this.redis.exists(this.handoffKey(phone))) return true;
    const since = new Date(Date.now() - this.ttl() * 1000);
    const adminReplies = await this.db.getRepository(WhatsappReply).countBy({
      toPhone: phone,
      source: WhatsappReplySource.ADMIN,
      createdAt: MoreThan(since),
    });
    return adminReplies > 0;
  }

  /** True when the menu may go out now; atomic, so two quick messages get one menu. */
  private async menuCooldown(phone: string): Promise<boolean> {
    const set = await this.redis.set(
      `bot:m:${sha256(phone)}`,
      '1',
      'EX',
      MENU_COOLDOWN_S,
      'NX',
    );
    return set === 'OK';
  }

  /**
   * The occasion the number is a guest of: a live guest with that phone who was sent an
   * invitation, of an event that is not cancelled and whose admission has not closed; the nearest
   * one when there are several.
   */
  private async guestContext(phone: string): Promise<GuestContext | null> {
    const guests = await this.db
      .getRepository(Guest)
      .findBy({ phone, deletedAt: IsNull() });
    if (!guests.length) return null;
    const events = await this.db.getRepository(Event).findBy({
      id: In([...new Set(guests.map((g) => g.eventId))]),
      status: Not(EventStatus.CANCELLED),
      admissionClosesAt: MoreThan(new Date()),
    });
    events.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    for (const event of events) {
      for (const guest of guests.filter((g) => g.eventId === event.id)) {
        const invited = await this.db.getRepository(WhatsappMessage).existsBy({
          guestId: guest.id,
          kind: WhatsappMessageKind.INVITATION,
          state: In([WhatsappMessageState.SENT, WhatsappMessageState.UNKNOWN]),
        });
        if (!invited) continue;
        const content = event.approvedContentId
          ? await this.db
              .getRepository(InvitationContent)
              .findOneBy({ id: event.approvedContentId })
          : null;
        return { guest, event, content };
      }
    }
    return null;
  }

  private async markSeen(inboundId: string): Promise<void> {
    await this.db
      .getRepository(WhatsappInbound)
      .update({ id: inboundId, seenAt: IsNull() }, { seenAt: new Date() });
  }

  /** The wording the guest saw in the invitation, else the event's own fields. */
  private detailsText({ event, content }: GuestContext): string {
    const dateText =
      content?.variables.dateText ??
      new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
        timeZone: event.timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(event.startsAt);
    return [
      content?.variables.eventName ?? event.name,
      `📅 ${dateText}`,
      `📍 ${content?.variables.venue ?? event.venueName}`,
      ...(event.venueMapUrl ? [`🗺️ ${event.venueMapUrl}`] : []),
    ].join('\n');
  }

  private eventName({ event, content }: GuestContext): string {
    return content?.variables.eventName ?? event.name;
  }

  private aboutText(): string {
    return [
      'أثر إيفنتس منصة لدعوات الأعراس والمناسبات على واتساب:',
      'نرسل الدعوة لضيوفك، ويردّون بالحضور أو الاعتذار بضغطة، ومن يؤكد حضوره تصله بطاقة دخول يُمسح رمزها عند الباب.',
      '',
      `كيف تعمل: ${this.appOrigin}/how-it-works`,
    ].join('\n');
  }

  private packagesText(): string {
    return [
      'اختر الباقة حسب عدد ضيوفك، والأسعار شاملة الضريبة:',
      `${this.appOrigin}/packages`,
    ].join('\n');
  }

  private ttl(): number {
    return this.handoffHours * 3600;
  }

  private handoffKey(phone: string): string {
    return `bot:h:${sha256(phone)}`;
  }
}
