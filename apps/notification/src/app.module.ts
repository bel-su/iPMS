import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { IamDirectoryClient } from './directory/iam-directory.client.js';
import { QcNotificationConsumer } from './events/qc-notification.consumer.js';
import { NotificationController } from './notifications/notification.controller.js';
import { NotificationService } from './notifications/notification.service.js';
import { PrismaService } from './prisma.service.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * `notification`'s routes return only the caller's own rows, enforced by the
 * `recipientId` filter in `NotificationService`, and none passes a resource to
 * `check()`. An empty, non-global scope is therefore the *least* permissive value
 * available to it, not a stub. Do NOT "fix" this into `global: true` — that would
 * silently grant scope-based access to every project and site the moment a future
 * change passes a resource into `check()`.
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
 * registration endpoint exists yet. In-app delivery is live (spec 2026-10-02);
 * add transport beside `QcNotificationConsumer`, as another sink for the same
 * decision, not as a second consumer of the same events.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController, MetricsController, NotificationController],
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
      provide: NotificationService,
      useFactory: (prisma: PrismaService): NotificationService => new NotificationService(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: IamDirectoryClient,
      useFactory: (): IamDirectoryClient => new IamDirectoryClient(
        process.env['IAM_INTERNAL_URL'] ?? 'http://iam:3001',
        requireEnv('INTERNAL_SERVICE_KEY'),
      ),
    },
    {
      provide: QcNotificationConsumer,
      useFactory: (notifications: NotificationService, iam: IamDirectoryClient, bus: EventBus): QcNotificationConsumer =>
        new QcNotificationConsumer(notifications, iam, bus),
      inject: [NotificationService, IamDirectoryClient, EventBus],
    },
  ],
})
export class AppModule {}
