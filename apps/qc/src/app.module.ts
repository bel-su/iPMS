import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { SiteGeofenceClient } from './submissions/site-geofence.client.js';
import { SubmissionController } from './submissions/submission.controller.js';
import { SubmissionService } from './submissions/submission.service.js';

// Least-permissive scope: no qc route passes a resource to check(), so scope is never consulted.
const scopeProvider: ScopeProvider = { async for(): Promise<AuthzScope> { return { global: false, projectIds: [], siteIds: [] }; } };

const projectInternalUrl = (): string => process.env['PROJECT_INTERNAL_URL'] ?? 'http://project:3004';
const graceDays = (): number => Number(process.env['QC_RETIRED_VERSION_GRACE_DAYS'] ?? 7);

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [SubmissionController, HealthController, MetricsController],
  providers: [
    // Order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: scopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: PrismaService,
      useFactory: () => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    { provide: SiteGeofenceClient, useFactory: () => new SiteGeofenceClient(projectInternalUrl()) },
    {
      provide: SubmissionService,
      useFactory: (prisma: PrismaService, geofence: SiteGeofenceClient) => new SubmissionService(prisma.db, geofence, graceDays()),
      inject: [PrismaService, SiteGeofenceClient],
    },
  ],
})
export class AppModule {}
