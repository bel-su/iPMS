import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';

/**
 * `docs` has no resource-bearing endpoints yet, so `check()` never consults a
 * scope. An empty, non-global scope is therefore the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true` — that
 * would silently grant scope-based access to every project and site the moment
 * a future change passes a resource into `check()`.
 */
const docsScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController],
  providers: [
    // Registration order matters: APP_GUARD providers run in the order they are
    // listed. JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: docsScopeProvider },
    /**
     * `AuthzGuard` passes overrides to `check()`, so every service must provide
     * this token or fail at bootstrap. docs returns none, which is the *least*
     * permissive option rather than a gap: global overrides are already resolved
     * into the JWT `permissions` claim at issuance, and this service has no
     * routes passing a `resource` for a scoped override to apply to.
     */
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
  ],
})
export class AppModule {}
