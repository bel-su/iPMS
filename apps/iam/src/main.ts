import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('iam');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.enableShutdownHooks();
  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'iam service listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'iam service failed to start');
  process.exit(1);
});
