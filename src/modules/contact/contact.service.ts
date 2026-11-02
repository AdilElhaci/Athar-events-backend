import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { EnvironmentVariables } from '../../config/env.validation';
import {
  badRequest,
  notFound,
  tooManyRequests,
} from '../../shared/exceptions/app.exception';
import { escapeLike } from '../../shared/pagination';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { RateLimitService } from '../auth/services/rate-limit.service';
import { MailService } from '../mail/mail.service';
import { contactMessageMail } from '../mail/mail.templates';
import { normalizeSaudiMobile } from '../users/utils/phone';
import { ContactMessageDto } from './contact.dto';
import { AdminContactMessagesQueryDto } from './dto/contact-message.dto';
import {
  ContactMessage,
  ContactMessageStatus,
} from './entities/contact-message.entity';

/** Messages allowed per client IP per hour (on top of the route throttle). */
const MESSAGES_PER_IP_PER_HOUR = 5;

/**
 * Stores contact-form messages for the admin dashboard and notifies the team inbox by e-mail
 * (D-34). The client IP is used for rate limiting only and is not stored.
 */
@Injectable()
export class ContactService {
  constructor(
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly mail: MailService,
    private readonly rateLimits: RateLimitService,
    @InjectRepository(ContactMessage)
    private readonly messages: Repository<ContactMessage>,
    private readonly dataSource: DataSource,
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

    await this.messages.insert({
      name: dto.name,
      phone,
      subject: dto.subject,
    });

    const inbox =
      this.config.get('CONTACT_INBOX', { infer: true }) ||
      this.config.getOrThrow('MAIL_FROM', { infer: true });
    this.mail.sendLater(
      inbox,
      contactMessageMail({ name: dto.name, phone, subject: dto.subject }),
    );
  }

  list(
    query: AdminContactMessagesQueryDto,
  ): Promise<[ContactMessage[], number]> {
    const qb = this.messages
      .createQueryBuilder('m')
      .orderBy('m.createdAt', 'DESC')
      .addOrderBy('m.id', 'ASC');
    const search = query.search?.trim();
    if (search) {
      // Phones are stored as 9665…; admins usually type the local 05… form.
      const phone = search.replace(/^\+/, '').replace(/^0(?=5)/, '966');
      qb.andWhere(
        "(m.name ILIKE :term ESCAPE '\\' OR m.subject ILIKE :term ESCAPE '\\' OR m.phone LIKE :phone ESCAPE '\\')",
        {
          term: `%${escapeLike(search)}%`,
          phone: `%${escapeLike(phone)}%`,
        },
      );
    }
    if (query.status)
      qb.andWhere('m.status = :status', { status: query.status });

    return qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
  }

  countNew(): Promise<number> {
    return this.messages.count({
      where: { status: ContactMessageStatus.NEW },
    });
  }

  async get(id: string): Promise<ContactMessage> {
    const message = await this.messages.findOneBy({ id });
    if (!message) throw notFound();
    return message;
  }

  setStatus(
    actorUserId: string,
    id: string,
    status: ContactMessageStatus,
  ): Promise<ContactMessage> {
    return this.transition(actorUserId, id, status);
  }

  /** Conditional: a stale tab opening a message must not undo "replied" or "closed". */
  markRead(actorUserId: string, id: string): Promise<ContactMessage> {
    return this.transition(
      actorUserId,
      id,
      ContactMessageStatus.READ,
      ContactMessageStatus.NEW,
    );
  }

  async remove(actorUserId: string, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.delete(ContactMessage, { id });
      if (!affected) throw notFound();
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'contact_message.deleted',
        targetType: 'contact_message',
        targetId: id,
      });
    });
  }

  /** Applies `to` under a row lock, only from `onlyFrom` when given; a no-op is not audited. */
  private transition(
    actorUserId: string,
    id: string,
    to: ContactMessageStatus,
    onlyFrom?: ContactMessageStatus,
  ): Promise<ContactMessage> {
    return this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(ContactMessage, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current) throw notFound();
      const from = current.status;
      if (from === to || (onlyFrom && from !== onlyFrom)) return current;

      current.status = to;
      const updated = await manager.save(current);
      await manager.insert(AdminAction, {
        actorUserId,
        action: 'contact_message.status_changed',
        targetType: 'contact_message',
        targetId: id,
        summary: { from, to },
      });
      return updated;
    });
  }
}
