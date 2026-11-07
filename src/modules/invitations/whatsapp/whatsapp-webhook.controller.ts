import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { unauthorized } from '../../../shared/exceptions/app.exception';
import { WhatsappWebhookService } from './whatsapp-webhook.service';

const CHALLENGE = /^[\w-]{1,200}$/;

/**
 * Called by Meta only. Register `https://<api domain>/api/whatsapp/webhook` with the verify token
 * and subscribe to the `messages` field. Bodies are never logged.
 */
@ApiTags('WhatsApp')
@Controller('whatsapp/webhook')
@SkipThrottle()
export class WhatsappWebhookController {
  constructor(private readonly webhooks: WhatsappWebhookService) {}

  /** Subscription handshake: echo `hub.challenge` as plain text, outside the JSON envelope. */
  @Get()
  @ApiOperation({ summary: 'Meta webhook verification handshake.' })
  verify(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') token: unknown,
    @Query('hub.challenge') challenge: unknown,
    @Res() res: Response,
  ): void {
    if (
      !this.webhooks.verifyHandshake(mode, token) ||
      typeof challenge !== 'string' ||
      !CHALLENGE.test(challenge)
    ) {
      res.status(HttpStatus.FORBIDDEN).end();
      return;
    }
    res.status(HttpStatus.OK).type('text/plain').send(challenge);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Meta webhook: statuses and button replies (X-Hub-Signature-256).',
  })
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (!this.webhooks.verifySignature(req.rawBody, signature))
      throw unauthorized();
    return this.webhooks.handle(body);
  }
}
