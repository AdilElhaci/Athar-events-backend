import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Arabic-Indic and Persian digits → ASCII, so pasted codes from Arabic keyboards work. */
const asciiDigits = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/\s+/g, '')
    : value;

export class EmailDto {
  @Transform(trim)
  @IsEmail({}, { message: 'email' })
  @MaxLength(254)
  email!: string;
}

export class RegisterStartDto extends EmailDto {
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;
}

export class RegisterVerifyDto extends EmailDto {
  @Transform(asciiDigits)
  @Matches(/^\d{6}$/, { message: 'code' })
  code!: string;
}

/** Passwords are never trimmed; length is checked in code points by the password policy. */
class PasswordField {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  password!: string;
}

export class RegisterCompleteDto extends PasswordField {
  @IsString()
  @Length(20, 100)
  registrationToken!: string;
}

export class LoginDto extends PasswordField {
  @Transform(trim)
  @IsEmail({}, { message: 'email' })
  @MaxLength(254)
  email!: string;
}

export class TokenPasswordDto extends PasswordField {
  @IsString()
  @Length(20, 100)
  token!: string;
}
