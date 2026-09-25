import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Redis } from 'ioredis';
import {
  AuthzGuard, JwtUserGuard, OVERRIDE_PROVIDER, SCOPE_PROVIDER, emptyOverrideProvider,
} from '@ipms/authz';
import { DurableConsumer, EventBus, RedisDedupeStore } from '@ipms/events';
import { HealthController, MetricsController, createLogger, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { ProjectController } from './project/project.controller.js';
import { ProjectService } from './project/project.service.js';
import { SiteImportService } from './project/import/site-import.service.js';
import { TemplateLookupClient } from './work-orders/template-lookup.client.js';
import { WorkOrderController } from './work-orders/work-order.controller.js';
import { WorkOrderService } from './work-orders/work-order.service.js';
import { TASK_STATUS_DEDUPE_PREFIX, TaskStatusConsumer } from './work-orders/task-status.consumer.js';
import { UserScopeRepository } from './scope/user-scope.repository.js';
import { projectScopeProvider } from './scope/scope.provider.js';
import { SCOPE_DEDUPE_PREFIX, ScopeConsumer } from './scope/scope.consumer.js';
import { ensureProjectionReplay, type DedupeReset } from './scope/replay.js';

const log = createLogger('project');

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * Rebuilds the scope projection if it has been lost, then starts consuming.
 *
 * The order is load-bearing: the replay works by deleting the durable so that
 * the subscribe which follows recreates it and redelivers from the start.
 * Subscribing first would re-create the durable at its stored position and the
 * replay would have nothing to do.
 */
class ScopeBootstrap implements OnModuleInit {
  constructor(
    private readonly bus: EventBus,
    private readonly prisma: PrismaService,
    private readonly repo: UserScopeRepository,
    private readonly consumer: ScopeConsumer,
  ) {}

  async onModuleInit(): Promise<void> {
    const redis = new Redis(requireEnv('REDIS_URL'));

    /**
     * Deletes every dedupe key in this consumer's namespace.
     *
     * `unlink` rather than `del` so a large namespace is reclaimed off Redis's
     * main thread, and a cursor scan rather than `KEYS` so this never blocks it
     * for the length of the keyspace.
     */
    const dedupeReset: DedupeReset = {
      async clear(): Promise<void> {
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', `dedupe:${SCOPE_DEDUPE_PREFIX}:*`, 'COUNT', 500);
          cursor = next;
          if (keys.length > 0) await redis.unlink(...keys);
        } while (cursor !== '0');
      },
    };

    const replayed = await ensureProjectionReplay(this.bus, this.prisma.db, this.repo, dedupeReset);
    // The prefix namespaces dedupe keys per consumer, as audit does. Sharing one
    // namespace would let this consumer's ack of an eventId suppress a different
    // consumer's delivery of the same event.
    const dedupe = new RedisDedupeStore(redis as never, SCOPE_DEDUPE_PREFIX);
    await this.consumer.register(new DurableConsumer(this.bus, dedupe));
    log.info({ replayed }, 'scope projection consumer started');
  }
}

/**
 * Starts the consumer that moves task status from qc's submission events.
 * Its own dedupe namespace, for the reason ScopeBootstrap gives.
 */
class TaskStatusBootstrap implements OnModuleInit {
  constructor(private readonly bus: EventBus, private readonly consumer: TaskStatusConsumer) {}

  async onModuleInit(): Promise<void> {
    const redis = new Redis(requireEnv('REDIS_URL'));
    const dedupe = new RedisDedupeStore(redis as never, TASK_STATUS_DEDUPE_PREFIX);
    await this.consumer.register(new DurableConsumer(this.bus, dedupe));
    log.info('task status consumer started');
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [ProjectController, WorkOrderController, HealthController, MetricsController],
  providers: [
    { provide: APP_GUARD, useClass: JwtUserGuard },
    { provide: APP_GUARD, useClass: AuthzGuard },
    {
      provide: PrismaService,
      useFactory: () => {
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
      provide: UserScopeRepository,
      useFactory: (prisma: PrismaService) => new UserScopeRepository(prisma.db),
      inject: [PrismaService],
    },
    /**
     * The real provider, reading the replicated projection.
     *
     * This used to be a constant returning an empty, non-global scope. That was
     * harmless only because nothing read it: no query was constrained, so every
     * holder of project.view saw every project. Now that every query is
     * constrained, a stub here would deny everyone instead -- and a `global:
     * true` stub would hand everyone everything. Neither is acceptable, which
     * is why this is a factory over the projection.
     */
    {
      provide: SCOPE_PROVIDER,
      useFactory: (repo: UserScopeRepository) => projectScopeProvider(repo),
      inject: [UserScopeRepository],
    },
    // Project/site-scoped overrides are not replicated yet; global ones are
    // already folded into the JWT permissions claim, so global suspensions are
    // enforced today. See the note on emptyOverrideProvider in @ipms/authz.
    { provide: OVERRIDE_PROVIDER, useValue: emptyOverrideProvider },
    {
      provide: ScopeConsumer,
      useFactory: (repo: UserScopeRepository) => new ScopeConsumer(repo),
      inject: [UserScopeRepository],
    },
    {
      provide: ProjectService,
      useFactory: (prisma: PrismaService) => new ProjectService(prisma.db),
      inject: [PrismaService],
    },
    { provide: TemplateLookupClient, useFactory: () => new TemplateLookupClient(process.env['QC_INTERNAL_URL'] ?? 'http://qc:3005') },
    {
      provide: WorkOrderService,
      useFactory: (prisma: PrismaService, templates: TemplateLookupClient, scopes: UserScopeRepository) => new WorkOrderService(prisma.db, templates, scopes),
      inject: [PrismaService, TemplateLookupClient, UserScopeRepository],
    },
    {
      provide: SiteImportService,
      useFactory: (prisma: PrismaService) => new SiteImportService(prisma.db),
      inject: [PrismaService],
    },
    {
      provide: ScopeBootstrap,
      useFactory: (bus: EventBus, prisma: PrismaService, repo: UserScopeRepository, consumer: ScopeConsumer) =>
        new ScopeBootstrap(bus, prisma, repo, consumer),
      inject: [EventBus, PrismaService, UserScopeRepository, ScopeConsumer],
    },
    { provide: TaskStatusConsumer, useFactory: (prisma: PrismaService) => new TaskStatusConsumer(prisma.db), inject: [PrismaService] },
    {
      provide: TaskStatusBootstrap,
      useFactory: (bus: EventBus, consumer: TaskStatusConsumer) => new TaskStatusBootstrap(bus, consumer),
      inject: [EventBus, TaskStatusConsumer],
    },
  ],
})
export class AppModule {}
