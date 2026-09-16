import { describe, expect, it } from 'vitest';
import { getCorrelationId, runWithCorrelation } from './correlation.js';

describe('correlation context', () => {
  it('returns undefined outside of a correlation scope', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('exposes the id inside the scope', () => {
    const seen = runWithCorrelation('abc-123', () => getCorrelationId());
    expect(seen).toBe('abc-123');
  });

  it('survives an await boundary', async () => {
    const seen = await runWithCorrelation('abc-123', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getCorrelationId();
    });
    expect(seen).toBe('abc-123');
  });

  it('isolates concurrent scopes from each other', async () => {
    const [a, b] = await Promise.all([
      runWithCorrelation('a', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCorrelationId();
      }),
      runWithCorrelation('b', async () => getCorrelationId()),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
  });
});
