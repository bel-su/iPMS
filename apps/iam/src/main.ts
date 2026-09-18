import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLogger } from '@ipms/observability';
import { AppModule } from './app.module.js';

const log = createLogger('iam');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { bufferLogs: true });
  app.enableShutdownHooks();

  /**
   * Business routes live under the same `/api/v1` prefix the gateway forwards,
   * so a path is spelled identically whether it arrives through the edge or
   * directly against the container. That matters for zero-trust: every service
   * re-verifies the caller's token and must be safe to reach directly, so
   * "works through the gateway only" would be a debugging trap.
   *
   * Health and metrics are excluded. They are infrastructure endpoints the
   * orchestrator and the scrape job address by fixed path; prefixing them
   * would break the container healthcheck.
   */
  app.setGlobalPrefix('api/v1', {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  const port = Number(process.env['PORT'] ?? 3001);
  await app.listen({ port, host: '0.0.0.0' });
  log.info({ port }, 'iam service listening');
}

bootstrap().catch((err: unknown) => {
  log.fatal({ err }, 'iam service failed to start');
  process.exit(1);
});
