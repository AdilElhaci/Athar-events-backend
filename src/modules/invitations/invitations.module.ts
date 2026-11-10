import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Event } from '../events/entities/event.entity';
import { EventsModule } from '../events/events.module';
import { Guest } from '../guests/entities/guest.entity';
import { WebhookReceipt } from '../payments/entities/webhook-receipt.entity';
import { AdminInvitationsController } from './admin-invitations.controller';
import { InvitationContent } from './entities/invitation-content.entity';
import { WhatsappInbound } from './entities/whatsapp-inbound.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { InvitationsService } from './invitations.service';
import { OwnerInvitationController } from './owner-invitation.controller';
import { HttpWhatsappClient, WhatsappClient } from './whatsapp/whatsapp.client';
import { CampaignSenderService } from './whatsapp/campaign-sender.service';
import { WhatsappSenderService } from './whatsapp/whatsapp-sender.service';
import { WhatsappSweeperJob } from './whatsapp/whatsapp-sweeper.job';
import { WhatsappWebhookController } from './whatsapp/whatsapp-webhook.controller';
import { WhatsappWebhookService } from './whatsapp/whatsapp-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvitationContent,
      WhatsappMessage,
      WhatsappInbound,
      WebhookReceipt,
      Guest,
      Event,
    ]),
    AuthModule,
    EventsModule,
  ],
  controllers: [
    AdminInvitationsController,
    OwnerInvitationController,
    WhatsappWebhookController,
  ],
  providers: [
    InvitationsService,
    { provide: WhatsappClient, useClass: HttpWhatsappClient },
    WhatsappSenderService,
    CampaignSenderService,
    WhatsappWebhookService,
    WhatsappSweeperJob,
  ],
})
export class InvitationsModule {}
