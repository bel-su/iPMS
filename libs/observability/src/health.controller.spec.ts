import { beforeEach, describe, expect, it } from 'vitest';
import { HealthController, registerReadinessCheck, resetReadinessChecks } from './health.controller.js';

describe('HealthController', () => {
  beforeEach(() => resetReadinessChecks());

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

  it('readiness reports the failing dependency by name', async () => {
    registerReadinessCheck('db', async () => true);
    registerReadinessCheck('nats', async () => false);
    const result = await new HealthController().ready();
    expect(result.status).toBe('error');
    expect(result.checks).toEqual({ db: 'ok', nats: 'error' });
  });

  it('treats a throwing check as a failure rather than propagating', async () => {
    registerReadinessCheck('db', async () => { throw new Error('connection refused'); });
    const result = await new HealthController().ready();
    expect(result.status).toBe('error');
    expect(result.checks['db']).toBe('error');
  });
});
