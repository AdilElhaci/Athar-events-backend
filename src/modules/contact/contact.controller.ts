import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { withMessage } from '../../shared/interceptors/response.interceptor';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { ContactMessageDto } from './contact.dto';
import { ContactService } from './contact.service';

@ApiTags('Contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({
    summary:
      'Public contact form: stores the message and e-mails the team inbox.',
  })
  async send(@Body() dto: ContactMessageDto, @Req() req: Request) {
    await this.contact.submit(dto, req.ip ?? null);
    return withMessage(null, 'contact.sent');
  }
}
