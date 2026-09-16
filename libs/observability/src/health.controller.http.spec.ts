import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthController, registerReadinessCheck, resetReadinessChecks } from './health.controller.js';

describe('HealthController (HTTP)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    resetReadinessChecks();

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
    resetReadinessChecks();
  });

  it('GET /health/live returns 200 even when dependencies are failing', async () => {
    registerReadinessCheck('db', async () => false);

    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 with status ok when all checks pass', async () => {
    registerReadinessCheck('db', async () => true);
    registerReadinessCheck('nats', async () => true);

    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', checks: { db: 'ok', nats: 'ok' } });
  });

  it('GET /health/ready returns 503 when a check returns false', async () => {
    registerReadinessCheck('db', async () => true);
    registerReadinessCheck('nats', async () => false);

    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.checks).toEqual({ db: 'ok', nats: 'error' });
  });

  it('GET /health/ready returns 503 when a check throws', async () => {
    registerReadinessCheck('db', async () => {
      throw new Error('connection refused');
    });

    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.body.status).toBe('error');
    expect(response.body.checks).toEqual({ db: 'error' });
  });
});
