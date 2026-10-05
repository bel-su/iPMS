import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma-clients/finance';
import { startTestDb } from '../../prisma/test-db.js';
import { ACTORS } from '../../prisma/fixtures.js';
import { CategoryService } from './category.service.js';

let db: Awaited<ReturnType<typeof startTestDb>>;
let prisma: PrismaClient;
let service: CategoryService;
beforeAll(async () => { db = await startTestDb(); prisma = db.prisma; service = new CategoryService(prisma); }, 180_000);
afterAll(async () => { await db?.stop(); });

describe('categories', () => {
  it('lists active categories for everyone', async () => {
    const list = await service.list(ACTORS.engineer);
    expect(list.map((c) => c.code)).toEqual(['ACCOMMODATION', 'FUEL', 'LABOUR', 'MATERIALS', 'MISC', 'TRAVEL']);
    expect(list.every((c) => c.disabledAt === null)).toBe(true);
  });

  it('lets Finance add, rename and disable one, and hides the disabled from everyone else', async () => {
    const created = await service.create({ code: 'PERMITS', name: 'Permits' }, ACTORS.finance);
    expect(created).toMatchObject({ code: 'PERMITS', name: 'Permits', disabledAt: null });

    expect(await service.update(created.id, { name: 'Permits and fees' }, ACTORS.finance)).toMatchObject({ name: 'Permits and fees' });
    await service.update(created.id, { disabled: true }, ACTORS.finance);

    expect((await service.list(ACTORS.engineer)).map((c) => c.code)).not.toContain('PERMITS');
    expect((await service.list(ACTORS.finance)).find((c) => c.code === 'PERMITS')?.disabledAt).not.toBeNull();

    await service.update(created.id, { disabled: false }, ACTORS.finance);
    expect((await service.list(ACTORS.engineer)).map((c) => c.code)).toContain('PERMITS');
  });

  it('refuses a duplicate code and a caller who cannot manage categories', async () => {
    await expect(service.create({ code: 'TRAVEL', name: 'Again' }, ACTORS.finance)).rejects.toThrow(/already exists/);
    await expect(service.create({ code: 'NEWCAT', name: 'New' }, ACTORS.engineer)).rejects.toThrow(/finance_category\.manage/);
  });
});
