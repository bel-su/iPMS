import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';

export interface PrismaLike {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

export abstract class PrismaBaseService implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly client: PrismaLike;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
