import { beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@ipms/contracts';
import { UserScopeRepository } from './user-scope.repository.js';
import { projectScopeProvider } from './scope.provider.js';

const USER = uuidv7();
const OTHER = uuidv7();
const PROJECT_A = uuidv7();
const PROJECT_C = uuidv7();
const SITE_B = uuidv7();

interface Row { id: string; userId: string; level: string; projectId: string | null; siteId: string | null }

/**
 * Stands in for the three Prisma calls the repository makes, including the
 * partial unique indexes' behaviour. Small enough to be obviously correct,
 * which is what a fake for a boundary should be; the real constraints are the
 * database's job and are asserted by the migration itself.
 */
function fakePrisma() {
  const rows: Row[] = [];
  return {
    rows,
    userScope: {
      async findMany({ where }: { where: { userId: string } }) {
        return rows.filter((r) => r.userId === where.userId);
      },
      async create({ data }: { data: Row }) {
        const clash = rows.find((r) => r.userId === data.userId && r.level === data.level
          && r.projectId === data.projectId && r.siteId === data.siteId);
        if (clash) throw Object.assign(new Error('unique violation'), { code: 'P2002' });
        rows.push(data);
        return data;
      },
      async deleteMany({ where }: { where: Record<string, unknown> }) {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          const row = rows[i] as unknown as Record<string, unknown>;
          if (Object.entries(where).every(([k, v]) => row[k] === v)) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
      async count() { return rows.length; },
    },
  };
}

function build() {
  const prisma = fakePrisma();
  const repo = new UserScopeRepository(prisma as never);
  return { prisma, repo, provider: projectScopeProvider(repo) };
}

describe('UserScopeRepository', () => {
  let ctx: ReturnType<typeof build>;
  beforeEach(() => { ctx = build(); });

  it('denies a user with nothing replicated', async () => {
    // Fail-closed. An unreplicated projection is indistinguishable from "this
    // user was granted nothing", and denying is the only safe reading of both.
    expect(await ctx.provider.for(USER)).toEqual({ global: false, projectIds: [], siteIds: [] });
  });

  it('maps a GLOBAL grant onto AuthzScope.global', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null });
    expect(await ctx.provider.for(USER)).toEqual({ global: true, projectIds: [], siteIds: [] });
  });

  it('accumulates project and site grants for one user', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await ctx.repo.applyGranted({ userId: USER, level: 'SITE', projectId: PROJECT_C, siteId: SITE_B });
    expect(await ctx.provider.for(USER)).toEqual({
      global: false, projectIds: [PROJECT_A], siteIds: [SITE_B],
    });
  });

  it('is idempotent on a redelivered grant', async () => {
    // At-least-once delivery makes this routine. A duplicate row would survive
    // one revocation and keep access alive after it was withdrawn.
    const event = { userId: USER, level: 'PROJECT' as const, projectId: PROJECT_A, siteId: null };
    await ctx.repo.applyGranted(event);
    await ctx.repo.applyGranted(event);
    expect(ctx.prisma.rows).toHaveLength(1);
  });

  it('revokes only the named grant', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await ctx.repo.applyGranted({ userId: USER, level: 'SITE', projectId: PROJECT_C, siteId: SITE_B });
    await ctx.repo.applyRevoked({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    expect(await ctx.provider.for(USER)).toEqual({ global: false, projectIds: [], siteIds: [SITE_B] });
  });

  it('tolerates revoking something that was never granted', async () => {
    // A revocation can outrun its grant, or arrive twice. Neither is an error,
    // and throwing would dead-letter a message whose end state already holds.
    await expect(
      ctx.repo.applyRevoked({ userId: USER, level: 'PROJECT', projectId: PROJECT_A, siteId: null }),
    ).resolves.toBeUndefined();
  });

  it('clears every row for a deactivated user and nobody else', async () => {
    await ctx.repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null });
    await ctx.repo.applyGranted({ userId: OTHER, level: 'PROJECT', projectId: PROJECT_A, siteId: null });
    await ctx.repo.clearUser(USER);
    expect(await ctx.provider.for(USER)).toEqual({ global: false, projectIds: [], siteIds: [] });
    expect((await ctx.provider.for(OTHER)).projectIds).toEqual([PROJECT_A]);
  });

  it('reports an empty projection, so a lost one can be told from an idle one', async () => {
    expect(await ctx.repo.isEmpty()).toBe(true);
    await ctx.repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null });
    expect(await ctx.repo.isEmpty()).toBe(false);
  });

  it('rethrows an error that is not a unique violation', async () => {
    // Swallowing everything here would turn a broken database into a silently
    // empty projection, which denies every user while looking healthy.
    const repo = new UserScopeRepository({
      userScope: { async create() { throw Object.assign(new Error('connection lost'), { code: 'P1001' }); } },
    } as never);
    await expect(
      repo.applyGranted({ userId: USER, level: 'GLOBAL', projectId: null, siteId: null }),
    ).rejects.toThrow(/connection lost/);
  });
});
