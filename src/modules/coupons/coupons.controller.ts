import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
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
import { toEventView } from '../events/dto/event.dto';
import { UserType } from '../users/entities/user.entity';
import { CouponsService } from './coupons.service';
import {
  AdminCouponView,
  ApplyCouponDto,
  CreateCouponDto,
  toAdminCouponView,
  UpdateCouponDto,
} from './dto/coupon.dto';

@ApiTags('Admin — Coupons')
@ApiBearerAuth()
@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @ApiOperation({ summary: 'Every coupon, newest first.' })
  async list(
    @Query() query: PaginationQueryDto,
  ): Promise<Paginated<AdminCouponView>> {
    const [rows, total] = await this.coupons.list(query.page, query.limit);
    return {
      items: rows.map(toAdminCouponView),
      meta: buildMeta(total, query.page, query.limit),
    };
  }

  @Post()
  @UseGuards(CsrfGuard)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCouponDto,
  ) {
    const created = await this.coupons.create(user.id, dto);
    return withMessage(toAdminCouponView(created), 'coupon.created');
  }

  @Patch(':id')
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary:
      'Activate, deactivate, change the limit or expiry. Coupons are never deleted.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    const updated = await this.coupons.update(user.id, id, dto);
    return withMessage(toAdminCouponView(updated), 'coupon.updated');
  }
}

/** The owner's coupon on an unpaid event (D-48). */
@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.OWNER)
export class EventCouponController {
  constructor(private readonly coupons: CouponsService) {}

  @Put(':id/coupon')
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Applies a coupon to the unpaid event.' })
  async apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApplyCouponDto,
  ) {
    const event = await this.coupons.apply(user.id, id, dto.code);
    return withMessage(toEventView(event), 'coupon.applied');
  }

  @Delete(':id/coupon')
  @UseGuards(CsrfGuard)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const event = await this.coupons.remove(user.id, id);
    return withMessage(toEventView(event), 'coupon.removed');
  }
}
