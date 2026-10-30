import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../messages';

/** Error carrying a stable machine-readable `code`; the filter turns it into the Arabic message. */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
  ) {
    super({ code }, status);
  }
}

export const badRequest = (code: ErrorCode) =>
  new AppException(code, HttpStatus.BAD_REQUEST);
export const unauthorized = (code: ErrorCode = 'auth.unauthorized') =>
  new AppException(code, HttpStatus.UNAUTHORIZED);
export const forbidden = (code: ErrorCode = 'common.forbidden') =>
  new AppException(code, HttpStatus.FORBIDDEN);
export const conflict = (code: ErrorCode) =>
  new AppException(code, HttpStatus.CONFLICT);
export const tooManyRequests = (code: ErrorCode = 'common.too_many_requests') =>
  new AppException(code, HttpStatus.TOO_MANY_REQUESTS);
