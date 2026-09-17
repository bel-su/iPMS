import { describe, expect, it } from 'vitest';
import { uuidv7, UuidSchema } from './ids.js';

describe('uuidv7', () => {
  it('produces a valid v7 uuid', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
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
});
