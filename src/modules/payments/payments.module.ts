import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Event } from '../events/entities/event.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { WebhookReceipt } from './entities/webhook-receipt.entity';
import { HttpMoyasarClient, MoyasarClient } from './moyasar.client';
import { MoyasarWebhookService } from './moyasar-webhook.service';
import { PaymentApplyService } from './payment-apply.service';
import {
  EventPaymentsController,
  MoyasarWebhookController,
} from './payments.controller';
import { PaymentsReconcileJob } from './payments-reconcile.job';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PaymentAttempt, WebhookReceipt, Event]),
    AuthModule,
  ],
  controllers: [EventPaymentsController, MoyasarWebhookController],
  providers: [
    { provide: MoyasarClient, useClass: HttpMoyasarClient },
    PaymentApplyService,
    PaymentsService,
    MoyasarWebhookService,
    PaymentsReconcileJob,
  ],
})
export class PaymentsModule {}
