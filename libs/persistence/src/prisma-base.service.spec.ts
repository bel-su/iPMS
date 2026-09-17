import { describe, expect, it, vi } from 'vitest';
import { PrismaBaseService, type PrismaLike } from './prisma-base.service.js';

class FakePrismaClient implements PrismaLike {
  $connect = vi.fn<PrismaLike['$connect']>().mockResolvedValue(undefined);
  $disconnect = vi.fn<PrismaLike['$disconnect']>().mockResolvedValue(undefined);
  $queryRaw = vi.fn<PrismaLike['$queryRaw']>().mockResolvedValue([{ '?column?': 1 }]);
}

class TestPrismaService extends PrismaBaseService {
  constructor(protected readonly client: FakePrismaClient) {
    super();
  }
}

describe('PrismaBaseService', () => {
  it('onModuleInit connects to the database exactly once', async () => {
    const client = new FakePrismaClient();
    const service = new TestPrismaService(client);

    await service.onModuleInit();

    expect(client.$connect).toHaveBeenCalledTimes(1);
  });

  it('onModuleDestroy disconnects from the database exactly once', async () => {
    const client = new FakePrismaClient();
    const service = new TestPrismaService(client);

    await service.onModuleDestroy();

    expect(client.$disconnect).toHaveBeenCalledTimes(1);
  });

  it('isHealthy resolves true when the health query succeeds', async () => {
    const client = new FakePrismaClient();
    const service = new TestPrismaService(client);

    await expect(service.isHealthy()).resolves.toBe(true);
  });

  it('isHealthy resolves false, without throwing, when the health query rejects with an Error', async () => {
    const client = new FakePrismaClient();
    client.$queryRaw.mockRejectedValueOnce(new Error('connection terminated'));
    const service = new TestPrismaService(client);

    await expect(service.isHealthy()).resolves.toBe(false);
  });

  it('isHealthy resolves false when the health query rejects with a non-Error value', async () => {
    const client = new FakePrismaClient();
    client.$queryRaw.mockRejectedValueOnce('driver crashed');
    const service = new TestPrismaService(client);

    await expect(service.isHealthy()).resolves.toBe(false);
  });
});
