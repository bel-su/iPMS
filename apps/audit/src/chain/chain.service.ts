import { Injectable } from '@nestjs/common';
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import type { Prisma, PrismaClient } from '@prisma-clients/audit';
import { uuidv7 } from '@ipms/contracts';
import { getCorrelationId } from '@ipms/observability';
import type { AuditEventPayload } from '@ipms/events';
import { computeChainHash, verifyChain, GENESIS_HASH, type AuditBody, type AuditRow, type VerifyResult } from './hash.js';

/** Arbitrary but fixed. Every append contends on this one advisory lock. */
const CHAIN_LOCK_KEY = 8_531_207;

@Injectable()
export class ChainService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Appends one event. Serialized with a transaction-scoped advisory lock so
   * concurrent writers cannot read the same tail hash and fork the chain.
   */
  async append(payload: AuditEventPayload, occurredAt: Date, eventId = uuidv7()): Promise<AuditRow> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`;

      const existing = await tx.auditEvent.findUnique({ where: { eventId } });
      if (existing) return this.toRow(existing); // idempotent on redelivery

      const tail = await tx.auditEvent.findFirst({ orderBy: { sequence: 'desc' } });
      const sequence = (tail?.sequence ?? 0) + 1;
      const previousHash = tail?.chainHash ?? GENESIS_HASH;

      const body: AuditBody = {
        sequence,
        actorId: payload.actorId,
        action: payload.action,
        objectType: payload.objectType,
        objectId: payload.objectId,
        previousState: payload.previousState,
        newState: payload.newState,
        details: payload.details,
        timestamp: occurredAt.toISOString(),
      };

      const chainHash = computeChainHash(previousHash, body);

      const created = await tx.auditEvent.create({
        data: {
          id: uuidv7(),
          eventId,
          sequence,
          actorId: payload.actorId,
          action: payload.action,
          objectType: payload.objectType,
          objectId: payload.objectId,
          previousState: payload.previousState as Prisma.InputJsonValue,
          newState: payload.newState as Prisma.InputJsonValue,
          details: payload.details as Prisma.InputJsonValue,
          correlationId: getCorrelationId() ?? 'unknown',
          previousHash,
          chainHash,
          timestamp: occurredAt,
        },
      });

      return this.toRow(created);
    });
  }

  async verify(from?: number, to?: number): Promise<VerifyResult> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { sequence: { gte: from ?? 1, ...(to === undefined ? {} : { lte: to }) } },
      orderBy: { sequence: 'asc' },
    });
    return verifyChain(rows.map((r) => this.toRow(r)));
  }

  private toRow(r: {
    sequence: number;
    actorId: string | null;
    action: string;
    objectType: string;
    objectId: string;
    previousState: unknown;
    newState: unknown;
    details: unknown;
    timestamp: Date;
    previousHash: string;
    chainHash: string;
  }): AuditRow {
    return {
      sequence: r.sequence,
      actorId: r.actorId,
      action: r.action,
      objectType: r.objectType,
      objectId: r.objectId,
      previousState: r.previousState as Record<string, unknown>,
      newState: r.newState as Record<string, unknown>,
      details: r.details as Record<string, unknown>,
      timestamp: r.timestamp.toISOString(),
      previousHash: r.previousHash,
      chainHash: r.chainHash,
    };
  }
}
