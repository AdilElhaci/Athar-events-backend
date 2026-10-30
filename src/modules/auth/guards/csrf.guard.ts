import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import {
  corsOrigins,
  type EnvironmentVariables,
} from '../../../config/env.validation';
import { forbidden } from '../../../shared/exceptions/app.exception';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'athar-events';

/**
 * Applied to every endpoint that sets, rotates or clears the session cookie: the Origin must
 * match an allowed origin exactly and the custom header must be present (a cross-site form
 * cannot set it without a CORS preflight, which the allowlist rejects).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.allowed = new Set(
      corsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.get('origin');
    if (
      !origin ||
      !this.allowed.has(origin) ||
      request.get(CSRF_HEADER) !== CSRF_HEADER_VALUE
    ) {
      throw forbidden('auth.csrf');
    }
    return true;
  }
}
