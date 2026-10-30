import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { ErrorCode, messageFor } from '../messages';

/** Handlers may return `withMessage(data, code)` to pick the success message; otherwise a generic one is used. */
export class WithMessage<T> {
  constructor(
    readonly data: T,
    readonly code: ErrorCode,
  ) {}
}

export const withMessage = <T>(data: T, code: ErrorCode) =>
  new WithMessage(data, code);

/** Success envelope `{ success: true, message, data }` (Athar convention). */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof WithMessage) {
          const wrapped = value as WithMessage<unknown>;
          return {
            success: true,
            message: messageFor(wrapped.code),
            code: wrapped.code,
            data: wrapped.data,
          };
        }
        return {
          success: true,
          message: messageFor('common.ok'),
          data: value ?? null,
        };
      }),
    );
  }
}
