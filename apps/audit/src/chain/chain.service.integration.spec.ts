import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { ChainService } from './chain.service.js';
import { GENESIS_HASH } from './hash.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let service: ChainService;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  process.env['AUDIT_DATABASE_URL'] = connectionString;
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on macOS
    // when the path contains characters URL-escapes (spaces, unicode); fileURLToPath
    // decodes correctly in every case.
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  // Prisma ORM 7 removed `datasources`/`datasourceUrl` from the client constructor;
  // a driver adapter is now required to actually connect (schema-level `url` and the
  // old constructor option both throw). See apps/audit/prisma.config.ts and
  // apps/audit/src/prisma.service.ts for the same pattern used by the real app.
  const adapter = new PrismaPg({ connectionString });
  prisma = new PrismaClient({ adapter });
  service = new ChainService(prisma);

  await prisma.$executeRawUnsafe('ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_update');
  await prisma.$executeRawUnsafe('ALTER TABLE audit_event DISABLE TRIGGER audit_event_no_delete');
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.auditEvent.deleteMany();
});

const payload = (objectId: string) => ({
  actorId: 'u-1', action: 'role.created', objectType: 'Role', objectId,
  previousState: {}, newState: { code: 'QC' }, details: {},
});

describe('ChainService.append', () => {
  it('starts the chain from the genesis hash at sequence 1', async () => {
    const row = await service.append(payload('r-1'), new Date());
    expect(row.sequence).toBe(1);
    expect(row.previousHash).toBe(GENESIS_HASH);
  });

  it('links each row to its predecessor', async () => {
    const first = await service.append(payload('r-1'), new Date());
    const second = await service.append(payload('r-2'), new Date());
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.chainHash);
  });

  it('produces a chain that verifies', async () => {
    for (let i = 1; i <= 10; i += 1) await service.append(payload(`r-${i}`), new Date());
    expect(await service.verify()).toEqual({ valid: true, brokenAtSequence: null });
  });

  it('keeps the chain intact under concurrent appends', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => service.append(payload(`r-${i}`), new Date())));
    const rows = await prisma.auditEvent.findMany({ orderBy: { sequence: 'asc' } });
    expect(rows).toHaveLength(20);
    expect(rows.map((r) => r.sequence)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await service.verify()).toEqual({ valid: true, brokenAtSequence: null });
  });
});

describe('ChainService.verify', () => {
  it('detects a tampered row', async () => {
    for (let i = 1; i <= 5; i += 1) await service.append(payload(`r-${i}`), new Date());
    await prisma.auditEvent.update({ where: { sequence: 3 }, data: { action: 'role.deleted' } });
    expect(await service.verify()).toEqual({ valid: false, brokenAtSequence: 3 });
  });

  it('detects a deleted row', async () => {
    for (let i = 1; i <= 5; i += 1) await service.append(payload(`r-${i}`), new Date());
    await prisma.auditEvent.delete({ where: { sequence: 3 } });
    expect((await service.verify()).valid).toBe(false);
  });
});
