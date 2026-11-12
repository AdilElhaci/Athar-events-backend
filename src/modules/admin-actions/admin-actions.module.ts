import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminActionsController } from './admin-actions.controller';
import { AdminActionsService } from './admin-actions.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminActionsController],
  providers: [AdminActionsService],
})
export class AdminActionsModule {}
