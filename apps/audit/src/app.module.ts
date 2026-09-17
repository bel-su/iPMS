import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { EventBus, RedisDedupeStore } from '@ipms/events';
import { HealthController, MetricsController, registerReadinessCheck } from '@ipms/observability';
import { PrismaService } from './prisma.service.js';
import { ChainService } from './chain/chain.service.js';
import { AuditConsumer } from './ingest/audit.consumer.js';
import { AuditController } from './api/audit.controller.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AuditController, HealthController, MetricsController],
  providers: [
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
