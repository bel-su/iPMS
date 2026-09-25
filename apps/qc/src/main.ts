import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { GlobalExceptionFilter, createLogger } from '@ipms/observability';
import { TEMPLATE_IMPORT_FILE_BYTES } from '@ipms/contracts';
import { AppModule } from './app.module.js';

const log = createLogger('qc');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  await app.register(import('@fastify/multipart'), { limits: { fileSize: TEMPLATE_IMPORT_FILE_BYTES, files: 1 } });
  app.useGlobalFilters(new GlobalExceptionFilter('qc'));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  const port = Number(process.env['PORT'] ?? 3005);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'qc service listening');
}

bootstrap().catch((err: unknown) => { log.fatal({ err }, 'qc service failed to start'); process.exit(1); });
