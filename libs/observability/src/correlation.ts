import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ correlationId: string }>();

export function runWithCorrelation<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
