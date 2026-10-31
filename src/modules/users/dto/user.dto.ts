import { IsEnum, IsOptional } from 'class-validator';
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
