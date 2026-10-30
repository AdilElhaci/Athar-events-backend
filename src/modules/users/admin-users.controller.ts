import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { buildMeta, escapeLike, Paginated } from '../../shared/pagination';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import { AdminUsersQueryDto, toUserView, UserView } from './dto/user.dto';
import { User, UserType } from './entities/user.entity';

@ApiTags('Admin — Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminUsersController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Paginated users; search matches name or email literally.',
  })
  async list(@Query() query: AdminUsersQueryDto): Promise<Paginated<UserView>> {
    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u.createdAt', 'DESC')
      .addOrderBy('u.id', 'ASC');
    const search = query.search?.trim();
    if (search) {
      qb.andWhere(
        "(u.name ILIKE :term ESCAPE '\\' OR u.email ILIKE :term ESCAPE '\\')",
        { term: `%${escapeLike(search)}%` },
      );
    }
    if (query.type) qb.andWhere('u.type = :type', { type: query.type });
    if (query.status)
      qb.andWhere('u.status = :status', { status: query.status });

    const [rows, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return {
      items: rows.map(toUserView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }
}
