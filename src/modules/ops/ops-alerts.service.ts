import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { statfs } from 'node:fs/promises';
import type Redis from 'ioredis';
import { DataSource } from 'typeorm';
import {
  NodeEnv,
  type EnvironmentVariables,
} from '../../config/env.validation';
import { REDIS } from '../auth/services/rate-limit.service';
import {
  hasRole,
  HEARTBEAT_WORKER,
} from '../invitations/whatsapp/whatsapp-queue.service';
import { MailService } from '../mail/mail.service';
import { opsAlertMail } from '../mail/mail.templates';
import { REFUND_NEEDED_SQL } from '../payments/admin-payments.service';

const MINUTE = 60_000;
const LOCK_KEY = 'lock:ops:alerts';
const REPEAT_AFTER_S = 6 * 3600;
const WORKER_SILENT_MS = 3 * MINUTE;
const DISK_LIMIT = 0.8;

export type AlertId =
  | 'overdue_campaigns'
  | 'unknown_sends'
  | 'payments_to_refund'
  | 'stuck_payments'
  | 'worker_down'
  | 'send_failures'
  | 'template_not_approved'
  | 'disk_full';

export interface Alert {
  id: AlertId;
  title: string;
  detail: string;
}

/**
 * Operations alerts (operations.md "Monitoring and alerts"): every 5 minutes on the scheduler, the
 * conditions are checked; each one that holds is e-mailed to `OPS_ALERT_EMAIL`, then again only
 * every 6 hours while it lasts, and re-armed once it clears. Messages carry counts and event
 * reference codes only. Backups are not monitored: there is no off-host backup yet (owner,
 * 2026-11-12).
 */
@Injectable()
export class OpsAlertsService {
  private readonly logger = new Logger(OpsAlertsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly mail: MailService,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'ops-alerts' })
  async tick(): Promise<void> {
    if (
      this.config.get('NODE_ENV', { infer: true }) === NodeEnv.Test ||
      !hasRole(this.config, 'scheduler')
    )
      return;
    const locked = await this.redis
      .set(LOCK_KEY, '1', 'PX', 4 * MINUTE, 'NX')
      .catch(() => null);
    if (locked !== 'OK') return;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`Ops alerts failed: ${(error as Error).message}`);
    } finally {
      await this.redis.del(LOCK_KEY).catch(() => undefined);
    }
  }

  /** Checks once and notifies about alerts not sent in the last 6 hours; returns those sent. */
  async run(): Promise<Alert[]> {
    const active = await this.check();
    const activeIds = new Set(active.map((a) => a.id));
    const fresh: Alert[] = [];
    for (const alert of active) {
      const first = await this.redis.set(
        `alert:${alert.id}`,
        '1',
        'EX',
        REPEAT_AFTER_S,
        'NX',
      );
      if (first === 'OK') fresh.push(alert);
    }
    // A cleared condition alerts again the next time it happens.
    const all: AlertId[] = [
      'overdue_campaigns',
      'unknown_sends',
      'payments_to_refund',
      'stuck_payments',
      'worker_down',
      'send_failures',
      'template_not_approved',
      'disk_full',
    ];
    const cleared = all.filter((id) => !activeIds.has(id));
    if (cleared.length)
      await this.redis.del(...cleared.map((id) => `alert:${id}`));

    if (!fresh.length) return [];
    for (const alert of fresh)
      this.logger.warn(`Alert ${alert.id}: ${alert.detail}`);
    const to = this.config.get('OPS_ALERT_EMAIL', { infer: true });
    if (to) await this.mail.send(to, opsAlertMail(fresh));
    return fresh;
  }

  async check(now = Date.now()): Promise<Alert[]> {
    const q = <T>(sql: string, params: unknown[] = []) =>
      this.dataSource.query<T[]>(sql, params);
    const alerts: Alert[] = [];

    const overdue = await q<{ reference_code: string }>(
      `SELECT reference_code FROM events
        WHERE campaign_status = 'SCHEDULED' AND send_at < $1 AND starts_at > now()
        ORDER BY send_at LIMIT 10`,
      [new Date(now - 5 * MINUTE)],
    );
    if (overdue.length)
      alerts.push({
        id: 'overdue_campaigns',
        title: 'حملات تأخر إرسالها',
        detail: `${overdue.length} حملة مجدولة لم تبدأ بعد موعدها بخمس دقائق (${overdue.map((r) => r.reference_code).join('، ')}). تحقق من خدمة الإرسال وRedis.`,
      });

    const [unknown] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM whatsapp_messages WHERE state = 'UNKNOWN' AND resolution IS NULL`,
    );
    if (unknown.n)
      alerts.push({
        id: 'unknown_sends',
        title: 'رسائل غير مؤكدة',
        detail: `${unknown.n} رسالة واتساب حالتها غير مؤكدة. عالجها من تبويب «الرسائل» في المناسبة.`,
      });

    const [refund] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM payment_attempts p WHERE ${REFUND_NEEDED_SQL}`,
    );
    if (refund.n)
      alerts.push({
        id: 'payments_to_refund',
        title: 'دفعات تحتاج استرجاعاً',
        detail: `${refund.n} دفعة أخذها ميسّر ولم تُطبّق. أعد المبلغ من لوحة ميسّر ثم سجّله في «المدفوعات».`,
      });

    const [stuck] = await q<{ n: number }>(
      `SELECT count(*)::int AS n FROM payment_attempts WHERE status = 'PENDING' AND created_at < $1 AND created_at > $2`,
      [new Date(now - 30 * MINUTE), new Date(now - 48 * 60 * MINUTE)],
    );
    if (stuck.n)
      alerts.push({
        id: 'stuck_payments',
        title: 'دفعات معلّقة طويلاً',
        detail: `${stuck.n} دفعة معلّقة منذ أكثر من 30 دقيقة. جرّب «مطابقة مع ميسّر» في «المدفوعات».`,
      });

    const beat = Number(await this.redis.get(HEARTBEAT_WORKER).catch(() => 0));
    if (!beat || now - beat > WORKER_SILENT_MS)
      alerts.push({
        id: 'worker_down',
        title: 'خدمة الإرسال متوقفة',
        detail: beat
          ? `آخر نشاط لعامل الإرسال قبل ${Math.round((now - beat) / MINUTE)} دقيقة. أعد تشغيل الحاوية.`
          : 'لا يوجد أي نشاط مسجّل لعامل الإرسال. أعد تشغيل الحاوية.',
      });

    const failing = await q<{ reference_code: string }>(
      `SELECT e.reference_code FROM whatsapp_messages m JOIN events e ON e.id = m.event_id
        WHERE m.kind = 'INVITATION' AND m.updated_at > $1 AND m.state IN ('SENT', 'FAILED', 'UNKNOWN')
        GROUP BY e.id, e.reference_code
       HAVING count(*) >= 20 AND count(*) FILTER (WHERE m.state = 'FAILED') * 10 > count(*)
        LIMIT 10`,
      [new Date(now - 24 * 60 * MINUTE)],
    );
    if (failing.length)
      alerts.push({
        id: 'send_failures',
        title: 'فشل مرتفع في الإرسال',
        detail: `أكثر من 10% من الدعوات فشلت في: ${failing.map((r) => r.reference_code).join('، ')}. أوقف الحملة مؤقتاً وتحقق من القالب وجودة الرقم.`,
      });

    const templateStatus = this.config.get(
      'WHATSAPP_INVITATION_TEMPLATE_STATUS',
      { infer: true },
    );
    if (templateStatus !== 'APPROVED') {
      const [scheduled] = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM events WHERE campaign_status = 'SCHEDULED'`,
      );
      if (scheduled.n)
        alerts.push({
          id: 'template_not_approved',
          title: 'قالب الدعوة غير معتمد',
          detail: `${scheduled.n} حملة مجدولة وقالب الدعوة حالته ${templateStatus}. لن تبدأ قبل اعتماده.`,
        });
    }

    const used = await diskUsed();
    if (used !== null && used > DISK_LIMIT)
      alerts.push({
        id: 'disk_full',
        title: 'مساحة القرص',
        detail: `القرص ممتلئ بنسبة ${Math.round(used * 100)}%. احذف السجلات أو النسخ القديمة.`,
      });

    return alerts;
  }
}

async function diskUsed(): Promise<number | null> {
  try {
    const s = await statfs('/');
    return s.blocks ? 1 - s.bavail / s.blocks : null;
  } catch {
    return null;
  }
}
