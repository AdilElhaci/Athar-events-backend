import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import {
  ContactMessage,
  ContactMessageStatus,
} from '../entities/contact-message.entity';

export class AdminContactMessagesQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;
}

export class UpdateContactMessageStatusDto {
  @IsEnum(ContactMessageStatus)
  status!: ContactMessageStatus;
}

/** Admin shape of a contact message (`IContactMessage`). */
export interface ContactMessageView {
  id: string;
  name: string;
  phone: string;
  subject: string;
  status: ContactMessageStatus;
  createdAt: Date;
  updatedAt: Date;
}

export const toContactMessageView = (
  message: ContactMessage,
): ContactMessageView => ({
  id: message.id,
  name: message.name,
  phone: message.phone,
  subject: message.subject,
  status: message.status,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});
