import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('media');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.enableShutdownHooks();

  /**
   * Business routes live under the same `/api/v1` prefix the gateway forwards,
   * so a path is spelled identically whether it arrives through the edge or
   * directly against the container. Health and metrics are excluded: the
   * orchestrator and the scrape job address them by fixed path, and prefixing
   * them would break the container healthcheck.
   */
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  const port = Number(process.env['PORT'] ?? 3006);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'media service listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'media service failed to start');
  process.exit(1);
});
