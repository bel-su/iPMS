import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter, createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('finance');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.useGlobalFilters(new GlobalExceptionFilter('finance'));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  const port = Number(process.env['PORT'] ?? 3009);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'finance service listening');
}

bootstrap().catch((err: unknown) => { log.fatal({ err }, 'finance service failed to start'); process.exit(1); });
