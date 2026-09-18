import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER,
  type AuthzOverride, type AuthzScope, type OverrideProvider, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService, type TokenVersionStore } from './auth/auth.service.js';
import { PasswordService } from './auth/password.service.js';
import { TokenService, type TokenConfig } from './auth/token.service.js';
import { RolesController } from './roles/roles.controller.js';
import { RolesService } from './roles/roles.service.js';
import { ScopesController } from './scopes/scopes.controller.js';
import { ScopesService } from './scopes/scopes.service.js';
import { EffectiveController } from './effective/effective.controller.js';
import { EffectiveService } from './effective/effective.service.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';

const PRISMA_CLIENT = 'PRISMA_CLIENT';
const TOKEN_VERSIONS = 'TOKEN_VERSIONS';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * None of iam's controllers passes a `resource` to `check()`, and with no
 * resource `check()` returns right after the permission step — the scope this
 * provider returns is never read. An empty, non-global scope is therefore the
 * safe default: it is the *least* permissive value, not a stub. Querying the
 * scope tables here instead would cost two round trips on every guarded
 * request for a value that is then discarded.
 *
 * Do NOT "fix" this later by returning `global: true`. That would silently
 * grant scope-based access to every project and site the moment some future
 * change starts passing a resource into `check()`. When sub-project 2 needs
 * real scopes here, read them from the tables — iam owns them — and delete
 * this comment.
 */
const iamScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

/**
 * Real override rows, read from the table iam owns.
 *
 * Unlike the scope provider above, this one has to do real work: `check()`'s
 * DENY gate runs *before* the permission gate and before any resource is
 * consulted, so it fires on every guarded request, resource or not. Returning
 * an empty list here would put back the exact defect this closes — a DENY
 * override written, audited and reported, and then not enforced.
 *
 * Only unexpired rows are returned, and only for the acting user; `check()`
 * filters again by permission and resource, so this query is a coarse
 * pre-filter, not the decision.
 */
function iamOverrideProvider(prisma: PrismaService): OverrideProvider {
  return {
    async for(userId: string): Promise<AuthzOverride[]> {
      const now = new Date();
      const rows = await prisma.db.userPermissionOverride.findMany({
        where: {
          userId,
          OR: [{ validUntil: null }, { validUntil: { gte: now } }],
        },
        include: { permission: true },
      });
      return rows.map((o) => ({
        permission: o.permission.code,
        effect: o.effect === 'DENY' ? 'DENY' : 'ALLOW',
        projectId: o.projectId,
        siteId: o.siteId,
        validFrom: o.validFrom,
        validUntil: o.validUntil,
      }));
    },
  };
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AuthController, RolesController, ScopesController, EffectiveController, HealthController, MetricsController],
  providers: [
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', async () => {
          try { await prisma.db.$queryRaw`SELECT 1`; return true; } catch { return false; }
        });
        return prisma;
      },
    },
    {
      provide: PRISMA_CLIENT,
      useFactory: (prisma: PrismaService) => prisma.db,
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
      // Adapts ioredis to the narrow `TokenVersionStore` port. The named
      // import is deliberate: ioredis 6's ESM default export is not
      // constructable under this TypeScript configuration, and
      // `new (await import('ioredis')).default(...)` fails at bootstrap with
      // "Redis is not a constructor" — a fault no unit test sees, because
      // every test injects a fake.
      provide: TOKEN_VERSIONS,
      useFactory: (): TokenVersionStore => {
        const redis = new Redis(requireEnv('REDIS_URL'));
        registerReadinessCheck('redis', async () => {
          try { return (await redis.ping()) === 'PONG'; } catch { return false; }
        });
        return {
          async publish(userId: string, tokenVersion: number, ttlSeconds: number): Promise<void> {
            await redis.set(`tokenVersion:${userId}`, String(tokenVersion), 'EX', ttlSeconds);
          },
        };
      },
    },
    {
      provide: TokenService,
      useFactory: (): TokenService => {
        const config: TokenConfig = {
          secret: requireEnv('JWT_SECRET'),
          accessTtl: Number(process.env['JWT_ACCESS_TTL'] ?? 900),
          refreshTtl: Number(process.env['JWT_REFRESH_TTL'] ?? 2_592_000),
        };
        return new TokenService(config);
      },
    },
    { provide: SCOPE_PROVIDER, useValue: iamScopeProvider },
    {
      provide: OVERRIDE_PROVIDER,
      useFactory: iamOverrideProvider,
      inject: [PrismaService],
    },
    {
      provide: APP_GUARD,
      useClass: JwtUserGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthzGuard,
    },
    PasswordService,
    // Every service below is provided through a factory with an explicit
    // `inject` list rather than as a bare class. That is load-bearing, not
    // style: each constructor takes `PrismaClient` (and here `TokenVersionStore`)
    // as an `import type`, which TypeScript erases — `emitDecoratorMetadata`
    // would record `Object` and Nest would fail at bootstrap with an
    // unresolvable token. Do not "simplify" these into bare class entries.
    {
      provide: AuthService,
      useFactory: (
        prisma: PrismaService, passwords: PasswordService,
        tokens: TokenService, versions: TokenVersionStore,
      ) => new AuthService(prisma.db as never, passwords, tokens, versions),
      inject: [PrismaService, PasswordService, TokenService, TOKEN_VERSIONS],
    },
    {
      provide: RolesService,
      useFactory: (prisma: PrismaService) => new RolesService(prisma.db as never),
      inject: [PrismaService],
    },
    {
      // `versions` is the same `TokenVersionStore` port `AuthService` writes
      // through, not a second path to Redis: an override write has to revoke
      // the target's tokens, because global overrides live in the token claim.
      provide: ScopesService,
      useFactory: (prisma: PrismaService, versions: TokenVersionStore, tokens: TokenService) =>
        new ScopesService(prisma.db as never, versions, tokens),
      inject: [PrismaService, TOKEN_VERSIONS, TokenService],
    },
    {
      provide: EffectiveService,
      useFactory: (prisma: PrismaService) => new EffectiveService(prisma.db as never),
      inject: [PrismaService],
    },
    {
      provide: OutboxDrainer,
      useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db as never, bus),
      inject: [PrismaService, EventBus],
    },
  ],
})
export class AppModule {}
