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
import { WhatsappMedia } from './entities/whatsapp-media.entity';
import { WhatsappReply } from './entities/whatsapp-reply.entity';
import { InvitationsService } from './invitations.service';
import { MessagesService } from './messages.service';
import { ReplacementsService } from './replacements.service';
import { RsvpReviewsService } from './rsvp-reviews.service';
import { AdminRsvpReviewsController } from './admin-rsvp-reviews.controller';
import { InboxService } from './inbox.service';
import { InboxMediaService } from './inbox-media.service';
import { InboxPushService } from './inbox-push.service';
import { PushModule } from '../push/push.module';
import { AdminInboxController } from './admin-inbox.controller';
import { OwnerInvitationController } from './owner-invitation.controller';
import { AdminWhatsappTemplatesController } from './whatsapp/admin-whatsapp-templates.controller';
import { HttpWhatsappClient, WhatsappClient } from './whatsapp/whatsapp.client';
import { CampaignSenderService } from './whatsapp/campaign-sender.service';
import { JourneyService } from './journey/journey.service';
import { JourneyTemplatesService } from './journey/journey-templates.service';
import { WhatsappSenderService } from './whatsapp/whatsapp-sender.service';
import { WhatsappQueue } from './whatsapp/whatsapp-queue.service';
import { WhatsappSweeperJob } from './whatsapp/whatsapp-sweeper.job';
import { WhatsappWebhookController } from './whatsapp/whatsapp-webhook.controller';
import { WhatsappTemplatesService } from './whatsapp/whatsapp-templates.service';
import { WhatsappWebhookService } from './whatsapp/whatsapp-webhook.service';
import { WhatsappDemoController } from './whatsapp/whatsapp-demo.controller';
import { WhatsappBotService } from './whatsapp/whatsapp-bot.service';
import { WhatsappDemoService } from './whatsapp/whatsapp-demo.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InvitationContent,
      WhatsappMessage,
      WhatsappInbound,
      WhatsappReply,
      WhatsappMedia,
      WebhookReceipt,
      Guest,
      Event,
      AdminAction,
    ]),
    AuthModule,
    EventsModule,
    PushModule,
  ],
  controllers: [
    AdminRsvpReviewsController,
    AdminInvitationsController,
    OwnerInvitationController,
    WhatsappWebhookController,
    AdminWhatsappTemplatesController,
    AdminMessagesController,
    AdminInboxController,
    AdminReplacementsController,
    WhatsappDemoController,
  ],
  providers: [
    InvitationsService,
    { provide: WhatsappClient, useClass: HttpWhatsappClient },
    WhatsappSenderService,
    CampaignSenderService,
    JourneyService,
    JourneyTemplatesService,
    WhatsappWebhookService,
    WhatsappSweeperJob,
    WhatsappQueue,
    WhatsappTemplatesService,
    MessagesService,
    InboxService,
    InboxMediaService,
    InboxPushService,
    ReplacementsService,
    RsvpReviewsService,
    WhatsappDemoService,
    WhatsappBotService,
  ],
})
export class InvitationsModule {}
