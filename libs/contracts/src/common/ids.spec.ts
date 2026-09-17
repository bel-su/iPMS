import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7, UuidSchema } from './ids.js';
import type * as IdsModule from './ids.js';

const V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv7', () => {
  it('produces a valid v7 uuid', () => {
    const id = uuidv7();
    expect(id).toMatch(V7_PATTERN);
  });

  it('sorts lexicographically in generation order', () => {
    const ids = [uuidv7(), uuidv7(), uuidv7()];
    expect([...ids].sort()).toEqual(ids);
  });

  it('accepts its own output', () => {
    expect(UuidSchema.safeParse(uuidv7()).success).toBe(true);
  });

  it('rejects a non-uuid string', () => {
    expect(UuidSchema.safeParse('not-a-uuid').success).toBe(false);
  });

  it('rejects a well-formed v4 uuid', () => {
    // Regression guard for Finding 3: the schema must accept only v7, not v1-v8.
    const v4 = 'a1b2c3d4-e5f6-4789-8abc-def012345678';
    expect(UuidSchema.safeParse(v4).success).toBe(false);
  });

  describe('monotonic clock discipline (deterministic, fake timers)', () => {
    // Each test gets its own fresh module instance (vi.resetModules + dynamic
    // import) so the module-level lastMs/counter state from the real-timer
    // tests above never leaks in, and pinned times below the real "now"
    // (as used by these fixtures) still exercise the intended branch.
    beforeEach(() => {
      vi.useFakeTimers();
      vi.resetModules();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function freshUuidv7Module(): Promise<typeof IdsModule> {
      return import('./ids.js');
    }

    it('keeps 5000 ids generated inside one pinned millisecond strictly ascending', async () => {
      const { uuidv7: freshUuidv7, UuidSchema: freshSchema } = await freshUuidv7Module();
      const pinned = 1_700_000_000_000;
      vi.setSystemTime(pinned);

      const ids: string[] = [];
      for (let i = 0; i < 5000; i++) {
        ids.push(freshUuidv7());
      }

      // Exercises the counter-overflow path: 5000 > 4096 (0xfff + 1) ids
      // requested inside a single pinned millisecond, so the borrow-from-
      // next-millisecond logic must fire and ordering must still hold.
      const sorted = [...ids].sort();
      expect(sorted).toEqual(ids);

      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);

      for (const id of ids) {
        expect(freshSchema.safeParse(id).success).toBe(true);
      }
    });

    it('stays strictly ascending across a pinned backward clock step', async () => {
      const { uuidv7: freshUuidv7, UuidSchema: freshSchema } = await freshUuidv7Module();
      const t0 = 1_700_000_010_000;
      vi.setSystemTime(t0);
      const before = [freshUuidv7(), freshUuidv7(), freshUuidv7()];

      // Clock jumps backwards (NTP correction, VM migration, manual change).
      vi.setSystemTime(t0 - 5000);
      const after = [freshUuidv7(), freshUuidv7(), freshUuidv7()];

      const all = [...before, ...after];
      const sorted = [...all].sort();
      expect(sorted).toEqual(all);

      const unique = new Set(all);
      expect(unique.size).toBe(all.length);

      for (const id of all) {
        expect(freshSchema.safeParse(id).success).toBe(true);
      }
    });

    it('stays strictly ascending across a normal forward clock step', async () => {
      const { uuidv7: freshUuidv7, UuidSchema: freshSchema } = await freshUuidv7Module();
      const t0 = 1_700_000_020_000;
      vi.setSystemTime(t0);
      const before = [freshUuidv7(), freshUuidv7(), freshUuidv7()];

      vi.setSystemTime(t0 + 1000);
      const after = [freshUuidv7(), freshUuidv7(), freshUuidv7()];

      const all = [...before, ...after];
      const sorted = [...all].sort();
      expect(sorted).toEqual(all);

      const unique = new Set(all);
      expect(unique.size).toBe(all.length);

      for (const id of all) {
        expect(freshSchema.safeParse(id).success).toBe(true);
      }
    });
  });
});
