import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode, messageFor } from '../messages';

const STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  400: 'common.bad_request',
  401: 'auth.unauthorized',
  403: 'common.forbidden',
  404: 'common.not_found',
  409: 'common.conflict',
  429: 'common.too_many_requests',
};

/** Error envelope `{ success:false, message, error, statusCode, code }` (Athar convention, W7 fixed). */
/** Errors raised by Express's body parser carry `type` like `entity.parse.failed`. */
function isBodyParserError(error: unknown): error is { type: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    (error as { type: string }).type.startsWith('entity.')
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'common.internal';
    let details: string[] | undefined;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'common.too_many_requests';
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as { message?: unknown };
      if (status === HttpStatus.BAD_REQUEST && Array.isArray(body?.message)) {
        code = 'common.validation';
        details = body.message.filter(
          (m): m is string => typeof m === 'string',
        );
      } else {
        code = STATUS_CODES[status] ?? 'common.internal';
      }
    } else if (
      exception instanceof QueryFailedError &&
      (exception.driverError as { code?: string })?.code === '23505'
    ) {
      status = HttpStatus.CONFLICT;
      code = 'common.conflict';
    } else if (isBodyParserError(exception)) {
      // Malformed or oversized JSON: the parser's message can quote the body, so it is never logged.
      status =
        exception.type === 'entity.too.large'
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : HttpStatus.BAD_REQUEST;
      code = 'common.bad_request';
    } else {
      // Error type and stack frames only — never the message, which may carry request data (W6).
      const err = exception instanceof Error ? exception : undefined;
      const frames = err?.stack?.split('\n').slice(1).join('\n');
      this.logger.error(`unhandled ${err?.name ?? typeof exception}`, frames);
    }

    const message = messageFor(code);
    response.status(status).json({
      success: false,
      message,
      error: details ?? message,
      statusCode: status,
      code,
    });
  }
}
