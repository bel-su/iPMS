import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { SiteGeofenceClient } from './submissions/site-geofence.client.js';
import { SubmissionController } from './submissions/submission.controller.js';
import { SubmissionService } from './submissions/submission.service.js';
import { TaskChecklistController } from './tasks/task-checklist.controller.js';
import { TaskLookupClient } from './tasks/task-lookup.client.js';
import { TemplateController } from './templates/template.controller.js';
import { TemplateImportController } from './templates/template-import.controller.js';
import { TemplateReferenceController } from './templates/template-reference.controller.js';
import { TemplateImportService } from './templates/template-import.service.js';
import { TemplateQueries } from './templates/template.queries.js';
import { TemplateService } from './templates/template.service.js';

// Least-permissive scope: no qc route passes a resource to check(), so scope is never consulted.
const scopeProvider: ScopeProvider = { async for(): Promise<AuthzScope> { return { global: false, projectIds: [], siteIds: [] }; } };

const projectInternalUrl = (): string => process.env['PROJECT_INTERNAL_URL'] ?? 'http://project:3004';
function graceDays(): number {
  const raw = process.env['QC_RETIRED_VERSION_GRACE_DAYS']?.trim();
  const value = raw ? Number(raw) : 7;
  if (!Number.isInteger(value) || value < 0) throw new Error('QC_RETIRED_VERSION_GRACE_DAYS must be a whole number of days');
  return value;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [TemplateImportController, TemplateController, TemplateReferenceController, SubmissionController, TaskChecklistController, HealthController, MetricsController],
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
    { provide: TaskLookupClient, useFactory: () => new TaskLookupClient(projectInternalUrl()) },
    {
      provide: SubmissionService,
      useFactory: (prisma: PrismaService, geofence: SiteGeofenceClient, tasks: TaskLookupClient) => new SubmissionService(prisma.db, geofence, graceDays(), tasks),
      inject: [PrismaService, SiteGeofenceClient, TaskLookupClient],
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
    { provide: OutboxDrainer, useFactory: (prisma: PrismaService, bus: EventBus) => new OutboxDrainer(prisma.db, bus), inject: [PrismaService, EventBus] },
    { provide: TemplateService, useFactory: (prisma: PrismaService) => new TemplateService(prisma.db), inject: [PrismaService] },
    { provide: TemplateQueries, useFactory: (prisma: PrismaService) => new TemplateQueries(prisma.db), inject: [PrismaService] },
    {
      provide: TemplateImportService,
      useFactory: (prisma: PrismaService, templates: TemplateService) => new TemplateImportService(prisma.db, templates),
      inject: [PrismaService, TemplateService],
    },
  ],
})
export class AppModule {}
