import { Type } from 'class-transformer';
import {
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

/** `PushSubscription.toJSON().keys` from the browser. */
export class PushKeysDto {
  /** The device's P-256 public key (65 bytes, base64url). */
  @IsString()
  @MaxLength(128)
  @Matches(BASE64URL)
  p256dh!: string;

  /** The 16-byte auth secret, base64url. */
  @IsString()
  @MaxLength(64)
  @Matches(BASE64URL)
  auth!: string;
}

export class SubscribePushDto {
  @IsString()
  @MaxLength(1024)
  endpoint!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

export class UnsubscribePushDto {
  @IsString()
  @MaxLength(1024)
  endpoint!: string;
}
