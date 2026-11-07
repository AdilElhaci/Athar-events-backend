import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { AdminGuestsController } from './admin-guests.controller';
import { GuestImport, GuestImportRow } from './entities/guest-import.entity';
import { Guest } from './entities/guest.entity';
import { GuestImportService } from './guest-import.service';
import { GuestsService } from './guests.service';
import { OwnerGuestsController } from './owner-guests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Guest, GuestImport, GuestImportRow]),
    AuthModule,
    EventsModule,
  ],
  controllers: [AdminGuestsController, OwnerGuestsController],
  providers: [GuestsService, GuestImportService],
})
export class GuestsModule {}
