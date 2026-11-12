import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminEventsController } from './admin-events.controller';
import { AdminEventsService } from './admin-events.service';
import { Event } from './entities/event.entity';
import { EventSummaryService } from './event-summary.service';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [TypeOrmModule.forFeature([Event]), AuthModule],
  controllers: [EventsController, AdminEventsController],
  providers: [EventsService, AdminEventsService, EventSummaryService],
  exports: [EventsService, AdminEventsService, TypeOrmModule],
})
export class EventsModule {}
