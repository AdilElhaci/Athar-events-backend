import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Public contact form (SCR-01 · 09). The phone format is checked in the service. */
export class ContactMessageDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsString()
  @MaxLength(30)
  phone!: string;

  @Transform(trim)
  @IsString()
  @Length(10, 2000)
  subject!: string;

  /** Honeypot: hidden from people, filled by bots. Any value means the message is dropped. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;
}
