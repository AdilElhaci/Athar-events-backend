import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  badRequest,
  serviceUnavailable,
} from '../../shared/exceptions/app.exception';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushVapid, WebPushClient } from './web-push.client';

/** What the service worker shows. `url` is a dashboard path; `tag` replaces an earlier one. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

export interface SubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Devices per admin; the oldest goes when a new one is added. */
const MAX_PER_USER = 10;
/** An offline phone still gets the message within this time. */
const TTL_SECONDS = 6 * 3600;

/**
 * Hosts of the browsers' push services. The server POSTs to the endpoint the browser gave, so
 * anything else is refused (no requests to arbitrary or internal hosts).
 */
const PUSH_HOSTS: Array<(host: string) => boolean> = [
  (h) => h === 'fcm.googleapis.com', // Chrome, Edge (Chromium), Opera, Samsung, Brave
  (h) => h === 'web.push.apple.com' || h.endsWith('.push.apple.com'), // Safari, iPhone
  (h) => h.endsWith('.push.services.mozilla.com'), // Firefox
  (h) => h.endsWith('.notify.windows.com'), // Edge (legacy)
];

export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    return false;
  const host = url.hostname.toLowerCase();
  return PUSH_HOSTS.some((allowed) => allowed(host));
}

/**
 * Web Push to admins' devices. Off unless the VAPID keys are set. Sends never throw and never
 * log an endpoint or a message; a subscription the push service says is gone is deleted.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly vapid: PushVapid | null;

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly client: WebPushClient,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    const publicKey = config.get('WEB_PUSH_PUBLIC_KEY', { infer: true });
    const privateKey = config.get('WEB_PUSH_PRIVATE_KEY', { infer: true });
    this.vapid =
      publicKey && privateKey
        ? {
            publicKey,
            privateKey,
            subject:
              config.get('WEB_PUSH_SUBJECT', { infer: true }) ??
              config.get('APP_ORIGIN', { infer: true }),
          }
        : null;
  }

  /** The key browsers subscribe with; null when push is off. */
  publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  /** Adds this device for the user, or moves it to them if another account had it. */
  async subscribe(userId: string, input: SubscriptionInput): Promise<void> {
    if (!this.vapid) throw serviceUnavailable('push.unavailable');
    if (!isPushEndpoint(input.endpoint))
      throw badRequest('push.endpoint_invalid');
    await this.db.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (endpoint) DO UPDATE
           SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
               auth = EXCLUDED.auth, updated_at = now()`,
        [userId, input.endpoint, input.p256dh, input.auth],
      );
      await manager.query(
        `DELETE FROM push_subscriptions WHERE id IN (
           SELECT id FROM push_subscriptions WHERE user_id = $1
            ORDER BY updated_at DESC OFFSET $2)`,
        [userId, MAX_PER_USER],
      );
    });
  }

  /** Only the user's own device; nothing happens for anyone else's endpoint. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.getRepository(PushSubscription).delete({ userId, endpoint });
  }

  /** The user's own devices: the dashboard's "send a test" button. Returns devices reached. */
  async sendToUser(userId: string, message: PushMessage): Promise<number> {
    if (!this.vapid) throw serviceUnavailable('push.unavailable');
    const targets = await this.db
      .getRepository(PushSubscription)
      .findBy({ userId });
    return this.deliver(targets, message);
  }

  /** Every active platform admin's devices. Never throws. Returns devices reached. */
  async sendToAdmins(message: PushMessage, topic?: string): Promise<number> {
    if (!this.vapid) return 0;
    try {
      const targets = await this.db
        .getRepository(PushSubscription)
        .createQueryBuilder('s')
        .innerJoin('users', 'u', 'u.id = s.user_id')
        .where(`u.type = 'PLATFORM_ADMIN' AND u.status = 'ACTIVE'`)
        .getMany();
      return await this.deliver(targets, message, topic);
    } catch (error) {
      this.logger.warn(`Push to admins failed: ${(error as Error).name}`);
      return 0;
    }
  }

  private async deliver(
    targets: PushSubscription[],
    message: PushMessage,
    topic?: string,
  ): Promise<number> {
    const vapid = this.vapid;
    if (!vapid || !targets.length) return 0;
    const payload = JSON.stringify(message);
    const results = await Promise.all(
      targets.map(async (target) => {
        const result = await this.client.send(target, payload, vapid, {
          ttl: TTL_SECONDS,
          topic,
        });
        if (result.ok) return true;
        if (result.status === 404 || result.status === 410)
          await this.db.getRepository(PushSubscription).delete(target.id);
        else this.logger.warn(`Push failed: status ${result.status ?? 'none'}`);
        return false;
      }),
    );
    return results.filter(Boolean).length;
  }
}
