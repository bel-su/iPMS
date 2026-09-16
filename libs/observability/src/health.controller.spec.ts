import { ServiceUnavailableException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HealthController, registerReadinessCheck, resetReadinessChecks } from './health.controller.js';

describe('HealthController', () => {
  beforeEach(() => resetReadinessChecks());
  afterEach(() => resetReadinessChecks());

  it('liveness always returns ok', async () => {
    expect(await new HealthController().live()).toEqual({ status: 'ok' });
  });

  it('readiness is ok when every check passes', async () => {
    registerReadinessCheck('db', async () => true);
    registerReadinessCheck('nats', async () => true);
    expect(await new HealthController().ready()).toEqual({
      status: 'ok',
      checks: { db: 'ok', nats: 'ok' },
    });
  });

  it('readiness reports the failing dependency by name, raised as a 503', async () => {
    registerReadinessCheck('db', async () => true);
    registerReadinessCheck('nats', async () => false);

    const error = await new HealthController().ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const exception = error as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    expect(exception.getResponse()).toEqual({
      status: 'error',
      checks: { db: 'ok', nats: 'error' },
    });
  });

  it('treats a throwing check as a failure rather than propagating, raised as a 503', async () => {
    registerReadinessCheck('db', async () => { throw new Error('connection refused'); });

    const error = await new HealthController().ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const exception = error as ServiceUnavailableException;
    expect(exception.getStatus()).toBe(503);
    const response = exception.getResponse() as { status: string; checks: Record<string, string> };
    expect(response.status).toBe('error');
    expect(response.checks['db']).toBe('error');
  });
});
