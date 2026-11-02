import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { IsOptional, IsUUID } from 'class-validator';
import { unauthorized } from '../../shared/exceptions/app.exception';
import { CurrentUser } from '../auth/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequireUserType, UserTypeGuard } from '../auth/guards/user-type.guard';
import type { AuthenticatedUser } from '../auth/types/auth.types';
import { UserType } from '../users/entities/user.entity';
import { MoyasarWebhookService } from './moyasar-webhook.service';
import {
  CheckoutView,
  PaymentStatusView,
  PaymentsService,
} from './payments.service';

class PaymentStatusQueryDto {
  @IsOptional()
  @IsUUID()
  paymentAttemptId?: string;
}

/** Owner checkout and status; scoped by `owner_id` like the rest of `/events`. */
@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(JwtAuthGuard, UserTypeGuard)
@RequireUserType(UserType.OWNER)
export class EventPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(':id/checkout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Opens the Moyasar hosted invoice for the event (reuses an open one).',
  })
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckoutView> {
    return this.payments.checkout(user.id, id);
  }

  @Get(':id/payment-status')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Payment state; a pending attempt is checked with Moyasar first.',
  })
  status(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PaymentStatusQueryDto,
  ): Promise<PaymentStatusView> {
    return this.payments.status(user.id, id, query.paymentAttemptId);
  }
}

/**
 * Server-to-server endpoints called by Moyasar. Bodies are read as plain objects (no DTO
 * whitelist) and never logged.
 */
@ApiTags('Payments')
@Controller('payments/moyasar')
@SkipThrottle()
export class MoyasarWebhookController {
  constructor(private readonly webhooks: MoyasarWebhookService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Moyasar webhook (secret_token in the body).' })
  async webhook(@Body() body: Record<string, unknown>) {
    if (!this.webhooks.verify(body)) throw unauthorized();
    return { outcome: await this.webhooks.handleWebhook(body) };
  }

  @Post('invoice-callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Moyasar invoice callback; the invoice is re-fetched before use.',
  })
  async invoiceCallback(@Body() body: Record<string, unknown>) {
    return { outcome: await this.webhooks.handleInvoiceCallback(body) };
  }
}
