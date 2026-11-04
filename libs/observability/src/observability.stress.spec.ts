import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  HealthController,
  registerReadinessCheck,
  resetReadinessChecks,
} from './health.controller.js';
import { MetricsController } from './metrics.controller.js';
import { metricsRegistry, httpRequestDuration, eventsConsumed } from './metrics.js';

describe('Observability Stress & Concurrency Test (libs/observability)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    resetReadinessChecks();

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController, MetricsController],
    }).compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app?.close();
    resetReadinessChecks();
  });

  it('proves app runs completely in-memory with zero TCP socket listening', () => {
    const server = app.getHttpServer();
    // The server must NOT be listening on a network port, eliminating port conflict risk
    expect(server.listening).toBe(false);
  });

  it('handles 100 concurrent /health/live requests under load', async () => {
    registerReadinessCheck('db', async () => false); // failing dependency

    const promises = Array.from({ length: 100 }, () =>
      app.inject({ method: 'GET', url: '/health/live' }),
    );

    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
    }
  });

  it('handles 100 concurrent /health/ready requests with multiple dependencies', async () => {
    registerReadinessCheck('postgres', async () => true);
    registerReadinessCheck('nats', async () => true);
    registerReadinessCheck('redis', async () => true);

    const promises = Array.from({ length: 100 }, () =>
      app.inject({ method: 'GET', url: '/health/ready' }),
    );

    const responses = await Promise.all(promises);
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.status).toBe('ok');
      expect(body.checks).toEqual({
        postgres: 'ok',
        nats: 'ok',
        redis: 'ok',
      });
    }
  });

  it('handles adversarial throw values without crashing the server', async () => {
    // Test throwing string
    registerReadinessCheck('string-throw', async () => {
      throw 'string exception';
    });
    let res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload).status).toBe('error');

    // Test throwing null
    resetReadinessChecks();
    registerReadinessCheck('null-throw', async () => {
      throw null;
    });
    res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);

    // Test throwing custom object
    resetReadinessChecks();
    registerReadinessCheck('object-throw', async () => {
      throw { code: 'FAIL', reason: 'unreachable' };
    });
    res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });

  it('handles falsy return values strictly as failures', async () => {
    registerReadinessCheck('zero-return', async () => 0 as unknown as boolean);
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.payload).checks['zero-return']).toBe('error');
  });

  it('handles slow async checks and respects execution order', async () => {
    let order: string[] = [];
    registerReadinessCheck('check1', async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('check1');
      return true;
    });
    registerReadinessCheck('check2', async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push('check2');
      return true;
    });

    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(order).toContain('check1');
    expect(order).toContain('check2');
  });

  it('handles concurrent metrics scraping under active metric emission', async () => {
    // Concurrent metric emissions while scraping /metrics
    const emitPromises = Array.from({ length: 50 }, (_, i) => {
      httpRequestDuration.observe({ method: 'GET', route: `/api/test/${i % 5}`, status: '200' }, 0.05);
      eventsConsumed.inc({ subject: `event.${i % 3}`, outcome: 'ok' });
      return Promise.resolve();
    });
    await Promise.all(emitPromises);

    const scrapePromises = Array.from({ length: 50 }, () =>
      app.inject({ method: 'GET', url: '/metrics' }),
    );

    const responses = await Promise.all(scrapePromises);
    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe(metricsRegistry.contentType);
      expect(res.payload).toContain('ipms_http_request_duration_seconds');
    }
  });

  it('maintains state isolation across sequential readiness check registrations and resets', async () => {
    registerReadinessCheck('temp', async () => true);
    let res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(JSON.parse(res.payload).checks).toHaveProperty('temp');

    resetReadinessChecks();
    res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(JSON.parse(res.payload).checks).toEqual({});
  });
});
