import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma-clients/project';
import { uuidv7 } from '@ipms/contracts';
import { SiteImportService } from '../src/project/import/site-import.service.js';

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let imports: SiteImportService;
let projectId: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  execSync('pnpm prisma migrate deploy', {
    // `new URL(..., import.meta.url).pathname` can come back percent-encoded on
    // macOS; fileURLToPath decodes correctly.
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: connectionString },
  });
  prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  imports = new SiteImportService(prisma);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await container?.stop();
});

beforeEach(async () => {
  await prisma.site.deleteMany({});
  await prisma.region.deleteMany({});
  await prisma.project.deleteMany({});
  projectId = uuidv7();
  await prisma.project.create({ data: { id: projectId, code: 'ALPHA', name: 'Alpha', defaultGeofenceRadiusM: 500 } });
});

const row = (over: Record<string, unknown>) => ({ rowNumber: 2, siteCode: 'S1', name: 'One', ...over });

/**
 * Calls the service directly, past the contract schema.
 *
 * Deliberate: these tests exercise what Postgres enforces, so one of them
 * sends a name longer than the schema would ever allow through the endpoint.
 */
const commit = (payload: { columns: string[]; rows: Array<Record<string, unknown>> }) =>
  imports.commit(projectId, payload as never);

describe('commit', () => {
  it('creates every row in one go', async () => {
    const result = await commit({
      columns: ['site_code', 'name'],
      rows: [row({ siteCode: 'S1', rowNumber: 2 }), row({ siteCode: 'S2', name: 'Two', rowNumber: 3 })],
    });
    expect(result).toEqual({ created: 2, updated: 0 });
    expect(await prisma.site.count({ where: { projectId } })).toBe(2);
  });

  it('updates an existing site rather than failing on its code', async () => {
    await commit({ columns: ['site_code', 'name'], rows: [row({})] });
    const result = await commit({ columns: ['site_code', 'name'], rows: [row({ name: 'Renamed' })] });
    expect(result).toEqual({ created: 0, updated: 1 });
    expect((await prisma.site.findFirst({ where: { projectId } }))?.name).toBe('Renamed');
  });

  // One region row for four hundred sites in the same region.
  it('deduplicates region upserts', async () => {
    await commit({
      columns: ['site_code', 'name', 'region'],
      rows: [
        row({ siteCode: 'S1', regionName: 'North', rowNumber: 2 }),
        row({ siteCode: 'S2', regionName: 'North', rowNumber: 3 }),
        row({ siteCode: 'S3', regionName: 'South', rowNumber: 4 }),
      ],
    });
    expect(await prisma.region.count({ where: { projectId } })).toBe(2);
  });

  /**
   * The all-or-nothing guarantee, tested where it actually bites.
   *
   * The failing row is an UPDATE, not a create. `commit` runs `createMany`
   * first and the individual updates after, so the insert of S1 has already
   * succeeded inside the transaction when S2's over-long name is rejected by
   * Postgres. Only a real rollback can make S1 disappear again — a version
   * that ran each statement outside a transaction would leave it behind.
   *
   * Putting the bad value in a create instead would prove nothing: `createMany`
   * is one statement and fails atomically on its own.
   */
  it('rolls back an already-inserted row when a later update fails', async () => {
    await prisma.site.create({ data: { id: uuidv7(), projectId, siteCode: 'S2', name: 'Existing' } });

    await expect(commit({
      columns: ['site_code', 'name'],
      rows: [
        row({ siteCode: 'S1', name: 'Fresh', rowNumber: 2 }),
        row({ siteCode: 'S2', name: 'x'.repeat(300), rowNumber: 3 }),
      ],
    })).rejects.toThrow();

    expect(await prisma.site.findFirst({ where: { projectId, siteCode: 'S1' } })).toBeNull();
    expect((await prisma.site.findFirst({ where: { projectId, siteCode: 'S2' } }))?.name).toBe('Existing');
    expect(await prisma.site.count({ where: { projectId } })).toBe(1);
  });

  it('refuses duplicate site codes within one commit', async () => {
    await expect(commit({
      columns: ['site_code', 'name'],
      rows: [row({ rowNumber: 2 }), row({ rowNumber: 3 })],
    })).rejects.toThrow('Duplicate site codes');
  });

  it('leaves a field alone when its column is absent, and clears it when present and blank', async () => {
    await commit({ columns: ['site_code', 'name', 'city'], rows: [row({ city: 'Kathmandu' })] });

    await commit({ columns: ['site_code', 'name'], rows: [row({})] });
    expect((await prisma.site.findFirst({ where: { projectId } }))?.city).toBe('Kathmandu');

    await commit({ columns: ['site_code', 'name', 'city'], rows: [row({ city: null })] });
    expect((await prisma.site.findFirst({ where: { projectId } }))?.city).toBeNull();
  });
});

describe('the geofence migration', () => {
  // Task 3's whole point: an existing site must not silently adopt the new
  // 500 m project default.
  it('leaves a migrated site on its own radius, and a new site inheriting', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "site" ("id","projectId","siteCode","name","geofenceMode","geofenceRadiusM") VALUES ($1,$2,'OLD','Old','CUSTOM',100)`,
      uuidv7(), projectId,
    );
    await commit({ columns: ['site_code', 'name'], rows: [row({ siteCode: 'NEW', name: 'New' })] });

    const old = await prisma.site.findFirst({ where: { projectId, siteCode: 'OLD' } });
    const fresh = await prisma.site.findFirst({ where: { projectId, siteCode: 'NEW' } });
    expect(old).toMatchObject({ geofenceMode: 'CUSTOM', geofenceRadiusM: 100 });
    expect(fresh).toMatchObject({ geofenceMode: 'INHERIT', geofenceRadiusM: null });
  });
});
