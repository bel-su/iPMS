import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
// Imported from this app's own generated-client location, not the shared
// `@prisma/client` package — see the `output` comment in schema.prisma.
import { PrismaClient } from '.prisma-client-audit';
import { Redis } from 'ioredis';
import { EventBus, RedisDedupeStore } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { PrismaService } from './prisma.service.js';
import { ChainService } from './chain/chain.service.js';
import { AuditConsumer } from './ingest/audit.consumer.js';
import { AuditController } from './api/audit.controller.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * `AuditController`'s two routes (`GET /audit/events`, `GET /audit/verify`) never pass a
 * `resource` to `check()` (see libs/authz/src/evaluate.ts) — with no resource, `check()`
 * returns `allowed: true` right after the permission check, and the scope this provider
 * returns is never consulted. An empty, non-global scope is therefore the safe default:
 * it is the *least* permissive value, not a stub. Do NOT "fix" this later by returning
 * `global: true` — that would silently grant scope-based access to every project and
 * site the moment some future change starts passing a resource into `check()`.
 */
const auditScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AuditController, HealthController, MetricsController],
  providers: [
    // Registration order matters: APP_GUARD providers run in the order they are listed.
    // JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: auditScopeProvider },
    /**
     * `AuthzGuard` now passes overrides to `check()`, so every service must
     * provide this token or fail at bootstrap.
     *
     * audit returns none, and that is the *least* permissive option available
     * to it rather than a gap. Global overrides (`projectId` and `siteId` both
     * null) are already resolved into the JWT `permissions` claim at issuance
     * by `resolvePermissions`, so a DENY suspension is enforced here through
     * the claim whatever this provider returns — nothing is silently
     * unenforced. What is left out is only project- and site-scoped overrides,
     * and `AuditController`'s routes pass no `resource` for one to apply to.
     *
     * Reading them properly means replicating override rows from iam over NATS,
     * which is sub-project 2's work; iam owns the table and audit has no
     * database access to it. When that lands, replace this with a provider over
     * the local projection.
     */
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    PrismaService,
    {
      // ChainService and AuditController take a bare PrismaClient (see Task 13);
      // PrismaService is the Prisma 7 driver-adapter wiring that produces it and
      // owns the connection lifecycle (onModuleInit/onModuleDestroy).
      provide: PrismaClient,
      useFactory: (prismaService: PrismaService): PrismaClient => {
        registerReadinessCheck('postgres', () => prismaService.isHealthy());
        return prismaService.db;
      },
      inject: [PrismaService],
    },
    {
      provide: EventBus,
      useFactory: async (): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(requireEnv('NATS_URL'));
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
    },
    {
      provide: RedisDedupeStore,
      useFactory: (): RedisDedupeStore =>
        new RedisDedupeStore(new Redis(requireEnv('REDIS_URL')) as never, 'audit'),
    },
    {
      // ChainService (Task 13) types its constructor parameter via `import type
      // { PrismaClient }`, which TypeScript erases — Nest's emitDecoratorMetadata
      // then reflects that parameter as the generic Function type and can't match
      // it to the `provide: PrismaClient` token above. A factory with an explicit
      // `inject` array sidesteps type-metadata reflection entirely.
      provide: ChainService,
      useFactory: (client: PrismaClient): ChainService => new ChainService(client),
      inject: [PrismaClient],
    },
    AuditConsumer,
  ],
})
export class AppModule {}
