import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import {
  buildMeta,
  Paginated,
  PaginationQueryDto,
} from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import {
  AdminPackageView,
  CreatePackageDto,
  toAdminPackageView,
  UpdatePackageDto,
} from './dto/package.dto';
import { PackagesService } from './packages.service';

@ApiTags('Admin — Packages')
@ApiBearerAuth()
@Controller('admin/packages')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminPackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get()
  @ApiOperation({ summary: 'Every package, active or not, in display order.' })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AdminPackageView>> {
    const [rows, total] = await this.packages.listAll(query.page, query.limit);
    return {
      items: rows.map(toAdminPackageView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePackageDto,
  ) {
    const created = await this.packages.create(user.id, dto);
    return withMessage(toAdminPackageView(created), 'package.created');
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Edit, activate or deactivate. Packages are never deleted.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePackageDto,
  ) {
    const updated = await this.packages.update(user.id, id, dto);
    return withMessage(toAdminPackageView(updated), 'package.updated');
  }
}
