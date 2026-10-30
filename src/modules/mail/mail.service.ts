import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { EnvironmentVariables } from '../../config/env.validation';
import { MailMessage } from './mail.templates';

/**
 * SMTP delivery from environment configuration. Sends are dispatched after the HTTP
 * response is built so response time does not reveal whether an email was sent.
 * Logs never contain recipients, codes or links.
 */
@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private from = '';

  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  onModuleInit(): void {
    const host = this.config.get('SMTP_HOST', { infer: true });
    this.from = `"${this.config.get('MAIL_FROM_NAME', { infer: true })}" <${this.config.get('MAIL_FROM', { infer: true })}>`;
    if (!host) {
      this.logger.warn('SMTP_HOST is not set: email delivery is disabled');
      return;
    }
    const user = this.config.get('SMTP_USER', { infer: true });
    this.transporter = createTransport({
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      auth: user
        ? { user, pass: this.config.get('SMTP_PASSWORD', { infer: true }) }
        : undefined,
    });
  }

  /** Fire-and-forget: never throws into the caller. */
  sendLater(to: string, message: MailMessage): void {
    setImmediate(() => void this.send(to, message));
  }

  async send(to: string, message: MailMessage): Promise<void> {
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      this.logger.error(
        `email delivery failed (${message.kind}): ${(error as Error).name}`,
      );
    }
  }
}
