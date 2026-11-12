import { Transform } from 'class-transformer';
import { IsEnum, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PaginationQueryDto } from '../../../shared/pagination';
import { User, UserStatus, UserType } from '../entities/user.entity';

/** Public shape of a user. Never includes the password hash or session version. */
export interface UserView {
  id: string;
  type: UserType;
  status: UserStatus;
  name: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export const toUserView = (user: User): UserView => ({
  id: user.id,
  type: user.type,
  status: user.status,
  name: user.name,
  email: user.email,
  phone: user.phone,
  emailVerifiedAt: user.emailVerifiedAt,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
});

export class AdminUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserType)
  type?: UserType;

  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;
}

/** SCR-27: suspend or reactivate; the reason goes to the admin action log. */
export class UpdateUserStatusDto {
  @IsIn([UserStatus.ACTIVE, UserStatus.SUSPENDED])
  status!: UserStatus.ACTIVE | UserStatus.SUSPENDED;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 300)
  reason!: string;
}
