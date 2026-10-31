import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  badRequest,
  tooManyRequests,
} from '../../shared/exceptions/app.exception';
import { RateLimitService } from '../auth/services/rate-limit.service';
import { MailService } from '../mail/mail.service';
import { contactMessageMail } from '../mail/mail.templates';
import { normalizeSaudiMobile } from '../users/utils/phone';
import { ContactMessageDto } from './contact.dto';

/** Messages allowed per client IP per hour (on top of the route throttle). */
const MESSAGES_PER_IP_PER_HOUR = 5;

/**
 * Forwards contact-form messages to the team inbox by e-mail. Nothing is stored: the inbox is
 * the record, so no new personal-data table is introduced.
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly mail: MailService,
    private readonly rateLimits: RateLimitService,
  ) {}

  async submit(dto: ContactMessageDto, ip: string | null): Promise<void> {
    if (dto.website) return; // honeypot: answer as if sent, send nothing

    const phone = normalizeSaudiMobile(dto.phone);
    if (!phone) throw badRequest('user.phone_invalid');

    if (
      !(await this.rateLimits.hit(
        'contact:ip',
        ip ?? 'unknown',
        MESSAGES_PER_IP_PER_HOUR,
        3600,
      ))
    ) {
      throw tooManyRequests();
    }

    const inbox =
      this.config.get('CONTACT_INBOX', { infer: true }) ||
      this.config.getOrThrow('MAIL_FROM', { infer: true });
    this.mail.sendLater(
      inbox,
      contactMessageMail({ name: dto.name, phone, subject: dto.subject }),
    );
  }
}
