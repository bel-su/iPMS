import { Controller, Get, Inject, Query } from '@nestjs/common';
// A real (not `import type`) binding: NestJS resolves constructor dependencies by
// the runtime class reference, both via the explicit @Inject(PrismaClient) below and
// via emitDecoratorMetadata's design:paramtypes, neither of which survive an erased
// type-only import (see apps/audit/src/app.module.ts for the matching provider).
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import { PrismaClient } from '.prisma-client-audit';
import { RequirePermission } from '@ipms/authz';
import { AuditQuerySchema, VerifyQuerySchema, type Paginated } from '@ipms/contracts';
import { ChainService } from '../chain/chain.service.js';
import type { VerifyResult } from '../chain/hash.js';

@Controller('audit')
export class AuditController {
  constructor(
    @Inject(PrismaClient) private readonly prisma: PrismaClient,
    private readonly chain: ChainService,
  ) {}

  @Get('events')
  @RequirePermission('audit.view')
  async list(@Query() rawQuery: unknown): Promise<Paginated<unknown>> {
    const q = AuditQuerySchema.parse(rawQuery);
    const where = {
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.objectType ? { objectType: q.objectType } : {}),
      ...(q.objectId ? { objectId: q.objectId } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.from || q.to
        ? { timestamp: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where, orderBy: { sequence: 'desc' }, skip: (q.page - 1) * q.limit, take: q.limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);

    return { items, total, page: q.page, limit: q.limit };
  }

  @Get('verify')
  @RequirePermission('audit.verify')
  async verify(@Query() rawQuery: unknown): Promise<VerifyResult> {
    const q = VerifyQuerySchema.parse(rawQuery);
    return this.chain.verify(q.from, q.to);
  }
}
