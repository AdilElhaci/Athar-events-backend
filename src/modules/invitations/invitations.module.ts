import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAction } from '../admin-actions/admin-action.entity';
import { AuthModule } from '../auth/auth.module';
import { Event } from '../events/entities/event.entity';
import { EventsModule } from '../events/events.module';
import { Guest } from '../guests/entities/guest.entity';
import { WebhookReceipt } from '../payments/entities/webhook-receipt.entity';
import { AdminInvitationsController } from './admin-invitations.controller';
import { AdminMessagesController } from './admin-messages.controller';
import { AdminReplacementsController } from './admin-replacements.controller';
import { InvitationContent } from './entities/invitation-content.entity';
import { WhatsappInbound } from './entities/whatsapp-inbound.entity';
import { WhatsappMessage } from './entities/whatsapp-message.entity';
import { WhatsappReply } from './entities/whatsapp-reply.entity';
import { InvitationsService } from './invitations.service';
import { MessagesService } from './messages.service';
import { ReplacementsService } from './replacements.service';
import { RepliesService } from './replies.service';
import { OwnerInvitationController } from './owner-invitation.controller';
import { AdminWhatsappTemplatesController } from './whatsapp/admin-whatsapp-templates.controller';
import { HttpWhatsappClient, WhatsappClient } from './whatsapp/whatsapp.client';
import { CampaignSenderService } from './whatsapp/campaign-sender.service';
import { WhatsappSenderService } from './whatsapp/whatsapp-sender.service';
import { WhatsappQueue } from './whatsapp/whatsapp-queue.service';
import { WhatsappSweeperJob } from './whatsapp/whatsapp-sweeper.job';
import { WhatsappWebhookController } from './whatsapp/whatsapp-webhook.controller';
import { WhatsappTemplatesService } from './whatsapp/whatsapp-templates.service';
import { WhatsappWebhookService } from './whatsapp/whatsapp-webhook.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvitationContent,
      WhatsappMessage,
      WhatsappInbound,
      WhatsappReply,
      WebhookReceipt,
      Guest,
      Event,
      AdminAction,
    ]),
    AuthModule,
    EventsModule,
  ],
  controllers: [
    AdminInvitationsController,
    OwnerInvitationController,
    WhatsappWebhookController,
    AdminWhatsappTemplatesController,
    AdminMessagesController,
    AdminReplacementsController,
  ],
  providers: [
    InvitationsService,
    { provide: WhatsappClient, useClass: HttpWhatsappClient },
    WhatsappSenderService,
    CampaignSenderService,
    WhatsappWebhookService,
    WhatsappSweeperJob,
    WhatsappQueue,
    WhatsappTemplatesService,
    MessagesService,
    RepliesService,
    ReplacementsService,
  ],
})
export class InvitationsModule {}
