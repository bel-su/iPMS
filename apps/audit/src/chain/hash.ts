import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditBody {
  sequence: number;
  actorId: string | null;
  action: string;
  objectType: string;
  objectId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface AuditRow extends AuditBody {
  previousHash: string;
  chainHash: string;
}

export interface VerifyResult {
  valid: boolean;
  brokenAtSequence: number | null;
}

/** Deterministic JSON: object keys sorted recursively, array order preserved, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(',')}}`;
}

export function computeChainHash(previousHash: string, body: AuditBody): string {
  return createHash('sha256').update(previousHash).update(canonicalJson(body)).digest('hex');
}

export function verifyChain(rows: AuditRow[]): VerifyResult {
  let expectedPrevious = GENESIS_HASH;
  let expectedSequence = rows.length > 0 ? rows[0]!.sequence : 1;

  for (const row of rows) {
    if (row.sequence !== expectedSequence) {
      return { valid: false, brokenAtSequence: row.sequence };
    }
    if (row.previousHash !== expectedPrevious) {
      return { valid: false, brokenAtSequence: row.sequence };
    }
    const { previousHash, chainHash, ...body } = row;
    if (computeChainHash(previousHash, body as AuditBody) !== chainHash) {
      return { valid: false, brokenAtSequence: row.sequence };
    }
    expectedPrevious = row.chainHash;
    expectedSequence += 1;
  }

  return { valid: true, brokenAtSequence: null };
}
