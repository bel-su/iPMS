import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetricsController } from './metrics.controller.js';
import { metricsRegistry } from './metrics.js';

describe('MetricsController (HTTP)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [MetricsController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /metrics returns 200 with the Prometheus content type and known metric names', async () => {
    const response = await request(app.getHttpServer()).get('/metrics');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe(metricsRegistry.contentType);
    expect(response.text).toContain('ipms_http_request_duration_seconds');
  });
});
