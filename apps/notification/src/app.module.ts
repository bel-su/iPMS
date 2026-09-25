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
 * `notification` has no resource-bearing endpoints yet, so `check()` never
 * consults a scope. An empty, non-global scope is therefore the *least*
 * permissive value available to it, not a stub. Do NOT "fix" this into
 * `global: true` — that would silently grant scope-based access to every
 * project and site the moment a future change passes a resource into `check()`.
 */
const notificationScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

/**
 * DEFERRED — push and email transport (spec 2026-09-20 §6.2).
 *
 * This service will deliver over FCM (Android, with iOS via the APNs bridge)
 * and an SMTP-compatible transactional provider — architecture spec §12,
 * assumption 1. Neither client, nor their credentials, nor a `DevicePushToken`
 * registration endpoint exists yet.
 *
 * That is deliberate, and the reason is sharper than tidiness: both are
 * outbound integrations with real-world side effects, and shipping working
 * credentials into a service that cannot yet decide *when* to send is how a
 * test environment mails production users.
 *
 * Add them with the first consumer of a `qc.submission.*` or `project.task.*`
 * event. Transport is meaningless before something decides a notification is
 * due, and becomes urgent the moment something does.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController],
  providers: [
    // Registration order matters: APP_GUARD providers run in the order they are
    // listed. JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: notificationScopeProvider },
    /**
     * `AuthzGuard` passes overrides to `check()`, so every service must provide
     * this token or fail at bootstrap. notification returns none, which is the
     * *least* permissive option rather than a gap: global overrides are already
     * resolved into the JWT `permissions` claim at issuance, and this service
     * has no routes passing a `resource` for a scoped override to apply to.
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
