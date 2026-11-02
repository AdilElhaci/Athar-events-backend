import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AdminContactMessagesController } from './admin-contact-messages.controller';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { ContactMessage } from './entities/contact-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ContactMessage]), AuthModule, MailModule],
  controllers: [ContactController, AdminContactMessagesController],
  providers: [ContactService],
})
export class ContactModule {}
