import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import helmet from 'helmet';
import {
  corsOrigins,
  type EnvironmentVariables,
} from './config/env.validation';
import { CSRF_HEADER } from './modules/auth/guards/csrf.guard';

/** Shared by main() and the e2e tests so both run the exact same HTTP pipeline. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const config = app.get(ConfigService<EnvironmentVariables, true>);
  app.set('trust proxy', config.get('TRUST_PROXY_HOPS', { infer: true }));
  app.disable('x-powered-by');
  app.use(helmet());
  app.use('/api/admin/articles', json({ limit: '512kb' })); // the only long-text payload
  app.use('/api/payments/moyasar', json({ limit: '64kb' })); // provider payloads
  app.use(json({ limit: '16kb' })); // bounded bodies: auth payloads are tiny
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: corsOrigins(config.get('CORS_ORIGINS', { infer: true })),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', CSRF_HEADER],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  return app;
}
