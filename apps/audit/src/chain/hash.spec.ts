import { describe, expect, it } from 'vitest';
import { canonicalJson, computeChainHash, verifyChain, GENESIS_HASH, type AuditBody } from './hash.js';

function body(overrides: Partial<AuditBody> = {}): AuditBody {
  return {
    sequence: 1,
    actorId: 'u-1',
    action: 'role.created',
    objectType: 'Role',
    objectId: 'r-1',
    previousState: {},
    newState: { code: 'QC_INSPECTOR' },
    details: {},
    timestamp: '2026-09-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('canonicalJson', () => {
  it('sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('produces identical output regardless of insertion order', () => {
    expect(canonicalJson({ z: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, z: 1 }));
  });

  it('preserves array order, which is semantic', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('emits no insignificant whitespace', () => {
    expect(canonicalJson({ a: 1 })).not.toContain(' ');
  });

  it('serializes null distinctly from absent', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });
});

describe('computeChainHash', () => {
  it('returns a 64-character lowercase hex digest', () => {
    expect(computeChainHash(GENESIS_HASH, body())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(computeChainHash(GENESIS_HASH, body())).toBe(computeChainHash(GENESIS_HASH, body()));
  });

  it('changes when any field of the body changes', () => {
    const base = computeChainHash(GENESIS_HASH, body());
    expect(computeChainHash(GENESIS_HASH, body({ action: 'role.updated' }))).not.toBe(base);
    expect(computeChainHash(GENESIS_HASH, body({ objectId: 'r-2' }))).not.toBe(base);
    expect(computeChainHash(GENESIS_HASH, body({ newState: { code: 'OTHER' } }))).not.toBe(base);
  });

  it('changes when the previous hash changes, which is what links the chain', () => {
    const a = computeChainHash(GENESIS_HASH, body());
    const b = computeChainHash('f'.repeat(64), body());
    expect(a).not.toBe(b);
  });

  it('is insensitive to key insertion order in state payloads', () => {
    const a = computeChainHash(GENESIS_HASH, body({ newState: { x: 1, y: 2 } }));
    const b = computeChainHash(GENESIS_HASH, body({ newState: { y: 2, x: 1 } }));
    expect(a).toBe(b);
  });
});

describe('verifyChain', () => {
  function buildChain(count: number) {
    const rows = [];
    let previousHash = GENESIS_HASH;
    for (let i = 1; i <= count; i += 1) {
      const b = body({ sequence: i, objectId: `r-${i}` });
      const chainHash = computeChainHash(previousHash, b);
      rows.push({ ...b, previousHash, chainHash });
      previousHash = chainHash;
    }
    return rows;
  }

  it('accepts an intact chain', () => {
    expect(verifyChain(buildChain(5))).toEqual({ valid: true, brokenAtSequence: null });
  });

  it('accepts an empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: true, brokenAtSequence: null });
  });

  it('detects a tampered payload and names the sequence', () => {
    const rows = buildChain(5);
    rows[2] = { ...rows[2]!, action: 'role.deleted' };
    expect(verifyChain(rows)).toEqual({ valid: false, brokenAtSequence: 3 });
  });

  it('detects a broken link between rows', () => {
    const rows = buildChain(5);
    rows[3] = { ...rows[3]!, previousHash: 'a'.repeat(64) };
    expect(verifyChain(rows)).toEqual({ valid: false, brokenAtSequence: 4 });
  });

  it('detects a deleted row via the sequence gap', () => {
    const rows = buildChain(5);
    rows.splice(2, 1);
    expect(verifyChain(rows).valid).toBe(false);
  });

  it('rejects a chain whose first row does not start from genesis', () => {
    const rows = buildChain(3);
    rows[0] = { ...rows[0]!, previousHash: 'b'.repeat(64) };
    expect(verifyChain(rows)).toEqual({ valid: false, brokenAtSequence: 1 });
  });
});
