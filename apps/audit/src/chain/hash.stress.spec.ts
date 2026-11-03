import { describe, expect, it } from 'vitest';
import {
  canonicalJson,
  computeChainHash,
  verifyChain,
  GENESIS_HASH,
  type AuditBody,
  type AuditRow,
} from './hash.js';

function createBody(sequence: number, overrides: Partial<AuditBody> = {}): AuditBody {
  return {
    sequence,
    actorId: `usr-${sequence}`,
    action: 'resource.updated',
    objectType: 'WorkOrder',
    objectId: `wo-${sequence}`,
    previousState: { status: 'PENDING', step: 1, tags: ['qc', 'site'] },
    newState: { status: 'APPROVED', step: 2, tags: ['qc', 'site'] },
    details: { reviewerId: 'u-admin', notes: `Verified block ${sequence}` },
    timestamp: new Date(1700000000000 + sequence * 60000).toISOString(),
    ...overrides,
  };
}

function generateChain(count: number, startSequence = 1): AuditRow[] {
  const rows: AuditRow[] = [];
  let previousHash = startSequence === 1 ? GENESIS_HASH : 'a'.repeat(64);

  for (let i = 0; i < count; i += 1) {
    const seq = startSequence + i;
    const body = createBody(seq);
    const chainHash = computeChainHash(previousHash, body);
    rows.push({
      ...body,
      previousHash,
      chainHash,
    });
    previousHash = chainHash;
  }
  return rows;
}

describe('Cryptographic Audit Chain Integrity Stress Harness', () => {
  describe('Partial Range Queries & Subranges (sequence > 1)', () => {
    const fullChain = generateChain(100, 1);

    it('validates arbitrary contiguous subranges without false-positive genesis breaks', () => {
      const ranges = [
        [0, 10],   // 1..10
        [5, 15],   // 6..15
        [10, 30],  // 11..30
        [49, 50],  // 50..50 (single row)
        [80, 100], // 81..100
        [98, 100], // 99..100
      ];

      for (const [start, end] of ranges) {
        const slice = fullChain.slice(start, end);
        const result = verifyChain(slice);
        expect(result.valid).toBe(true);
        expect(result.brokenAtSequence).toBeNull();
      }
    });

    it('rejects a sequence 1 row whose previousHash is not GENESIS_HASH', () => {
      const rows = generateChain(5, 1);
      rows[0] = { ...rows[0]!, previousHash: 'e'.repeat(64) };
      const result = verifyChain(rows);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(1);
    });

    it('detects payload tampering on the very first row of a subrange (sequence > 1)', () => {
      const slice = fullChain.slice(10, 20); // sequences 11 to 20
      const tampered = slice.map((r) => ({ ...r }));
      tampered[0] = { ...tampered[0]!, action: 'unauthorized.escalation' };

      const result = verifyChain(tampered);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(11);
    });

    it('detects payload tampering in the middle of a subrange', () => {
      const slice = fullChain.slice(20, 35); // sequences 21 to 35
      const tampered = slice.map((r) => ({ ...r }));
      tampered[5] = { ...tampered[5]!, newState: { status: 'TAMPERED' } };

      const result = verifyChain(tampered);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(26);
    });

    it('detects payload tampering on the final row of a subrange', () => {
      const slice = fullChain.slice(40, 50); // sequences 41 to 50
      const tampered = slice.map((r) => ({ ...r }));
      tampered[9] = { ...tampered[9]!, timestamp: '1970-01-01T00:00:00.000Z' };

      const result = verifyChain(tampered);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(50);
    });
  });

  describe('Sequence Discontinuities & Order Anomalies', () => {
    it('detects sequence gap in subrange and reports the missing sequence position', () => {
      const chain = generateChain(10, 10); // sequences 10..19
      // Remove sequence 14
      const gapped = chain.filter((r) => r.sequence !== 14);
      const result = verifyChain(gapped);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(15); // Sequence jump from 13 to 15
    });

    it('detects duplicated sequence numbers in chain', () => {
      const chain = generateChain(5, 5); // sequences 5..9
      const duplicated = [chain[0]!, chain[1]!, chain[1]!, chain[2]!];
      const result = verifyChain(duplicated);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(6);
    });

    it('detects reversed row ordering', () => {
      const chain = generateChain(5, 1);
      const reversed = [...chain].reverse();
      const result = verifyChain(reversed);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(4);
    });
  });

  describe('Cryptographic Link Breaks (previousHash & chainHash)', () => {
    it('detects previousHash corruption in subrange', () => {
      const chain = generateChain(10, 20); // sequences 20..29
      chain[3] = { ...chain[3]!, previousHash: '0'.repeat(63) + '1' };
      const result = verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(23);
    });

    it('detects chainHash corruption in subrange', () => {
      const chain = generateChain(10, 20); // sequences 20..29
      chain[7] = { ...chain[7]!, chainHash: 'f'.repeat(64) };
      const result = verifyChain(chain);
      expect(result.valid).toBe(false);
      expect(result.brokenAtSequence).toBe(27);
    });
  });

  describe('JSON Canonicalization & State Invariants', () => {
    it('is immune to dictionary key permutation across multiple nesting levels', () => {
      const objA = {
        z: 1,
        a: { gamma: 3, beta: 2, alpha: 1 },
        nested: { inner: { b: 2, a: 1 } },
      };
      const objB = {
        a: { alpha: 1, gamma: 3, beta: 2 },
        nested: { inner: { a: 1, b: 2 } },
        z: 1,
      };

      expect(canonicalJson(objA)).toBe(canonicalJson(objB));

      const hashA = computeChainHash(GENESIS_HASH, createBody(1, { newState: objA }));
      const hashB = computeChainHash(GENESIS_HASH, createBody(1, { newState: objB }));
      expect(hashA).toBe(hashB);
    });

    it('strictly distinguishes array ordering differences', () => {
      const hash1 = computeChainHash(GENESIS_HASH, createBody(1, { details: { items: [1, 2, 3] } }));
      const hash2 = computeChainHash(GENESIS_HASH, createBody(1, { details: { items: [3, 2, 1] } }));
      expect(hash1).not.toBe(hash2);
    });

    it('distinguishes explicit null from absent key', () => {
      const jsonNull = canonicalJson({ key: null });
      const jsonAbsent = canonicalJson({});
      expect(jsonNull).toBe('{"key":null}');
      expect(jsonAbsent).toBe('{}');
    });
  });

  describe('Monte Carlo Randomized Fuzzing (100 Iterations)', () => {
    const masterChain = generateChain(200, 1);

    it('consistently verifies 50 random valid subranges', () => {
      for (let i = 0; i < 50; i += 1) {
        const start = Math.floor(Math.random() * 150);
        const len = Math.floor(Math.random() * 40) + 1;
        const slice = masterChain.slice(start, start + len);

        const result = verifyChain(slice);
        expect(result.valid).toBe(true);
        expect(result.brokenAtSequence).toBeNull();
      }
    });

    it('achieves 100% detection rate across 50 randomly mutated subranges', () => {
      for (let i = 0; i < 50; i += 1) {
        const start = Math.floor(Math.random() * 150);
        const len = Math.floor(Math.random() * 30) + 5;
        const slice = masterChain.slice(start, start + len).map((r) => ({ ...r }));

        const mutationType = i % 5;
        const mutateIdx = Math.floor(Math.random() * slice.length);

        switch (mutationType) {
          case 0: // Alter payload
            slice[mutateIdx] = {
              ...slice[mutateIdx]!,
              newState: { ...slice[mutateIdx]!.newState, corrupted: Math.random() },
            };
            break;
          case 1: // Alter previousHash (for row > 0)
            if (mutateIdx > 0) {
              slice[mutateIdx] = {
                ...slice[mutateIdx]!,
                previousHash: 'd'.repeat(64),
              };
            } else {
              // If index 0, corrupt chainHash
              slice[0] = { ...slice[0]!, chainHash: 'c'.repeat(64) };
            }
            break;
          case 2: // Alter chainHash
            slice[mutateIdx] = {
              ...slice[mutateIdx]!,
              chainHash: 'e'.repeat(64),
            };
            break;
          case 3: // Delete an internal row to create a sequence gap
            {
              const internalIdx = Math.floor(Math.random() * (slice.length - 2)) + 1;
              slice.splice(internalIdx, 1);
            }
            break;
          case 4: // Corrupt timestamp
            slice[mutateIdx] = {
              ...slice[mutateIdx]!,
              timestamp: '2099-12-31T23:59:59.999Z',
            };
            break;
        }

        const result = verifyChain(slice);
        if (result.valid) {
          console.error(`FALSE NEGATIVE at iteration ${i}: mutationType=${mutationType}, mutateIdx=${mutateIdx}, slice.length=${slice.length}`);
          console.error('Slice rows:', slice.map(r => ({ seq: r.sequence, prev: r.previousHash.slice(0, 8), hash: r.chainHash.slice(0, 8) })));
        }
        expect(result.valid).toBe(false);
        expect(result.brokenAtSequence).not.toBeNull();
      }
    });
  });
});
