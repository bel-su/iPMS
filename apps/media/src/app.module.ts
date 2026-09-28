import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
  type AuthzScope, type ScopeProvider,
} from '@ipms/authz';
import { EventBus } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { AttachController } from './attach/attach.controller.js';
import { AttachService } from './attach/attach.service.js';
import { DiscardSweeper } from './cleanup/discard.sweeper.js';
import { WorkOrderCancelledConsumer } from './cleanup/work-order-cancelled.consumer.js';
import { loadConfig, type MediaConfig } from './config.js';
import { ProjectClient } from './directory/project.client.js';
import { QcClient } from './directory/qc.client.js';
import { MediaDiscarder } from './media/discarder.js';
import { OutboxDrainer } from './outbox/outbox.drainer.js';
import { PrismaService } from './prisma.service.js';
import { StorageClient } from './storage/storage.client.js';
import { UploadController } from './uploads/upload.controller.js';
import { UploadService } from './uploads/upload.service.js';
import { VerifyWorker } from './verify/verify.worker.js';
import { ViewController } from './viewing/view.controller.js';
import { ViewService } from './viewing/view.service.js';

/**
 * No media route passes a resource to check(), so this scope is never
 * consulted. Scope that matters is resolved per request from project (view
 * endpoints) or enforced by qc when it answers for a work order (uploads).
 * An empty, non-global scope is the least permissive value — do not "fix" it
 * into `global: true`.
 */
const mediaScopeProvider: ScopeProvider = {
  async for(): Promise<AuthzScope> {
    return { global: false, projectIds: [], siteIds: [] };
  },
};

const CONFIG = 'MEDIA_CONFIG';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [UploadController, ViewController, AttachController, HealthController, MetricsController],
  providers: [
    // Registration order matters: JwtUserGuard must populate request.user before AuthzGuard reads it.
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    { provide: SCOPE_PROVIDER, useValue: mediaScopeProvider },
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    { provide: CONFIG, useFactory: (): MediaConfig => loadConfig() },
    {
      provide: PrismaService,
      useFactory: (): PrismaService => {
        const prisma = new PrismaService();
        registerReadinessCheck('postgres', () => prisma.isHealthy());
        return prisma;
      },
    },
    {
      provide: StorageClient,
      useFactory: async (config: MediaConfig): Promise<StorageClient> => {
        const storage = new StorageClient(config.storage);
        if (config.storage.autoCreateBucket) await storage.ensureBucket();
        // A media that cannot reach its bucket must not hand out upload URLs.
        registerReadinessCheck('storage', () => storage.isHealthy());
        return storage;
      },
      inject: [CONFIG],
    },
    {
      provide: EventBus,
      useFactory: async (config: MediaConfig): Promise<EventBus> => {
        const bus = new EventBus();
        await bus.connect(config.natsUrl);
        await bus.ensureStreams();
        registerReadinessCheck('nats', () => bus.isHealthy());
        return bus;
      },
      inject: [CONFIG],
    },
    { provide: QcClient, useFactory: (config: MediaConfig) => new QcClient(config.qcUrl), inject: [CONFIG] },
    { provide: ProjectClient, useFactory: (config: MediaConfig) => new ProjectClient(config.projectUrl), inject: [CONFIG] },
    { provide: MediaDiscarder, useFactory: (p: PrismaService, s: StorageClient) => new MediaDiscarder(p.db, s), inject: [PrismaService, StorageClient] },
    {
      provide: UploadService,
      useFactory: (p: PrismaService, s: StorageClient, qc: QcClient, project: ProjectClient, d: MediaDiscarder) => new UploadService(p.db, s, qc, project, d),
      inject: [PrismaService, StorageClient, QcClient, ProjectClient, MediaDiscarder],
    },
    { provide: ViewService, useFactory: (p: PrismaService, s: StorageClient) => new ViewService(p.db, s), inject: [PrismaService, StorageClient] },
    { provide: AttachService, useFactory: (p: PrismaService) => new AttachService(p.db), inject: [PrismaService] },
    { provide: VerifyWorker, useFactory: (p: PrismaService, s: StorageClient) => new VerifyWorker(p.db, s), inject: [PrismaService, StorageClient] },
    { provide: OutboxDrainer, useFactory: (p: PrismaService, bus: EventBus) => new OutboxDrainer(p.db, bus), inject: [PrismaService, EventBus] },
    { provide: WorkOrderCancelledConsumer, useFactory: (p: PrismaService, bus: EventBus) => new WorkOrderCancelledConsumer(p.db, bus), inject: [PrismaService, EventBus] },
    { provide: DiscardSweeper, useFactory: (p: PrismaService, d: MediaDiscarder) => new DiscardSweeper(p.db, d), inject: [PrismaService, MediaDiscarder] },
  ],
})
export class AppModule {}
