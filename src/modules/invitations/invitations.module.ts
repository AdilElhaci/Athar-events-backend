import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { AdminInvitationsController } from './admin-invitations.controller';
import { InvitationContent } from './entities/invitation-content.entity';
import { InvitationsService } from './invitations.service';
import { OwnerInvitationController } from './owner-invitation.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([InvitationContent]),
    AuthModule,
    EventsModule,
  ],
  controllers: [AdminInvitationsController, OwnerInvitationController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
