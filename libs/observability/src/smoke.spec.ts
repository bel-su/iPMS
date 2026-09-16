import { describe, expect, it } from 'vitest';

describe('observability harness smoke test', () => {
  it('runs on a Node.js runtime satisfying the workspace engines constraint (>=22.13.0)', () => {
    const [major, minor] = process.version
      .slice(1)
      .split('.')
      .map((part) => Number.parseInt(part, 10)) as [number, number];

    const satisfiesMinimum = major > 22 || (major === 22 && minor >= 13);

    expect(satisfiesMinimum).toBe(true);
  });
});
