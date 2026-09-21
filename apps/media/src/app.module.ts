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
 * `media` has no resource-bearing endpoints yet, so `check()` never consults a
 * scope. An empty, non-global scope is therefore the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true` — that
 * would silently grant scope-based access to every project and site the moment
 * a future change starts passing a resource into `check()`.
 */
const mediaScopeProvider: ScopeProvider = {
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
    { provide: SCOPE_PROVIDER, useValue: mediaScopeProvider },
    /**
     * `AuthzGuard` passes overrides to `check()`, so every service must provide
     * this token or fail at bootstrap. media returns none, which is the *least*
     * permissive option available rather than a gap: global overrides are already
     * resolved into the JWT `permissions` claim at issuance by `resolvePermissions`,
     * and media has no routes passing a `resource` for a scoped override to apply to.
     */
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());

        /**
         * DEFERRED — object storage (spec 2026-09-20 §6.1).
         *
         * Evidence photos belong in Cloudflare R2 (architecture spec §12,
         * assumption 2). No S3 client, no `S3_*` configuration and no storage
         * readiness check exist yet, deliberately: configuration that nothing
         * reads is configuration that lies, and an operator who set `S3_BUCKET`
         * against this scaffold would reasonably conclude uploads were wired.
         *
         * Add all three in the same change as the first presigned-upload
         * endpoint. The readiness check is not optional once the client exists —
         * a `media` that reports ready while its bucket is unreachable will
         * accept presign requests it cannot honour.
         *
         * DEFERRED — media events and their stream (spec 2026-09-20 §6.3).
         *
         * `media.photo.processed` and `media.photo.rejected` (architecture spec
         * §8) are in neither `SUBJECTS` nor `STREAMS`, and the outbox table in
         * schema.prisma has no drainer. Both halves must land together:
         * `libs/events/src/subjects.spec.ts` asserts every subject is covered by
         * exactly one stream, which is the mechanical form of "a subject with no
         * stream is a message that vanishes". Adding the constants alone fails
         * that test; adding the stream alone creates durable consumers nothing
         * reads.
         *
         * Whichever comes first — the first producer here, or the first consumer
         * in `notification` — adds the subjects, the `MEDIA` stream and its
         * consumers in one change, widening the `STREAMS` key union as it goes.
         */
        return prisma;
      },
    },
  ],
})
export class AppModule {}
