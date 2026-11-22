import { Injectable } from '@nestjs/common';
import * as webpush from 'web-push';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushVapid {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface PushOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl: number;
  /** Same topic: the push service keeps only the latest undelivered message. */
  topic?: string;
}

/** HTTP status from the push service; 404/410 mean the subscription is gone. */
export type PushResult = { ok: true } | { ok: false; status: number | null };

/** The one place that talks to push services; replaced by a fake in tests. */
@Injectable()
export class WebPushClient {
  async send(
    target: PushTarget,
    payload: string,
    vapid: PushVapid,
    options: PushOptions,
  ): Promise<PushResult> {
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        payload,
        {
          vapidDetails: vapid,
          TTL: options.ttl,
          topic: options.topic,
          urgency: 'high',
          timeout: 10_000,
        },
      );
      return { ok: true };
    } catch (error) {
      const status = (error as { statusCode?: unknown }).statusCode;
      return { ok: false, status: typeof status === 'number' ? status : null };
    }
  }
}
