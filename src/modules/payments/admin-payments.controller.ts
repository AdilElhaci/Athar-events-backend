import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import type { Paginated } from '../../shared/pagination';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { AdminPaymentsService } from './admin-payments.service';
import {
  AdminPaymentsQueryDto,
  AdminPaymentView,
  RefundReasonDto,
} from './dto/admin-payment.dto';

/** SCR-26: payment attempts across all events (AC-08-5). */
@ApiTags('Admin — Payments')
@ApiBearerAuth()
@Controller('admin/payments')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.PLATFORM_ADMIN)
export class AdminPaymentsController {
  constructor(private readonly payments: AdminPaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'Newest first; filter by status or refund needed; search.',
  })
  list(
    @Query() query: AdminPaymentsQueryDto,
  ): Promise<Paginated<AdminPaymentView>> {
    return this.payments.list(query);
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Fetches a PENDING attempt from Moyasar now.' })
  async reconcile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return withMessage(
      await this.payments.reconcile(user.id, id),
      'payments.reconciled',
    );
  }

  @Post(':id/refund-done')
  @HttpCode(200)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary:
      'Records the manual refund of a payment that was taken but not applied.',
  })
  async refundDone(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundReasonDto,
  ) {
    return withMessage(
      await this.payments.markRefundDone(user.id, id, dto.reason),
      'payments.refund_done',
    );
  }
}
