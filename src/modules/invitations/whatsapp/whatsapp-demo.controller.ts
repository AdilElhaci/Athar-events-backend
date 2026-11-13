import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CsrfGuard } from '../../auth/guards/csrf.guard';
import { WhatsappDemoService } from './whatsapp-demo.service';

export class StartDemoDto {
  /** Checked and normalised in the service (Saudi mobiles only). */
  @IsString()
  @MaxLength(30)
  phone!: string;
}

/** Public "try the invitation on WhatsApp" demo (/try-whatsapp). No account needed. */
@ApiTags('WhatsApp demo')
@Controller('demo/whatsapp')
export class WhatsappDemoController {
  constructor(private readonly demo: WhatsappDemoService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({
    summary:
      'Starts a demo: returns the code the visitor sends from their WhatsApp to prove the number.',
  })
  start(@Body() dto: StartDemoDto, @Req() req: Request) {
    return this.demo.start(dto.phone, req.ip ?? null);
  }

  @Get('sessions/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Where the demo stands; the page polls it.' })
  status(@Param('id') id: string) {
    return this.demo.status(id);
  }

  @Post('sessions/:id/check-in')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Plays the door scan: sends the welcome message to the visitor.',
  })
  checkIn(@Param('id') id: string) {
    return this.demo.checkIn(id);
  }
}
