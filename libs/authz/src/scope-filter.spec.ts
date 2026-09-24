import { describe, expect, it } from 'vitest';
import { scopeWhere } from './scope-filter.js';

describe('scopeWhere', () => {
  it('returns an empty constraint for a global user', () => {
    expect(scopeWhere({ global: true, projectIds: [], siteIds: [] })).toEqual({});
  });

  it('treats project and site grants as alternatives, not conjuncts', () => {
    // A PM scoped to project p-1, plus one site in a project they cannot
    // otherwise see. Both must be reachable. The previous AND semantics matched
    // neither: every p-1 row failed the siteId test, and s-9 failed the
    // projectId test.
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: ['s-9'] })).toEqual({
      OR: [{ projectId: { in: ['p-1'] } }, { siteId: { in: ['s-9'] } }],
    });
  });

  it('still constrains when only projects are scoped', () => {
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: [] })).toEqual({
      OR: [{ projectId: { in: ['p-1'] } }, { siteId: { in: [] } }],
    });
  });

  it('matches nothing for a user with no scope at all', () => {
    // Both alternatives are `in: []`, which SQL evaluates to false. This is the
    // fail-closed case the whole design rests on: an unreplicated projection
    // denies rather than exposing everything.
    expect(scopeWhere({ global: false, projectIds: [], siteIds: [] })).toEqual({
      OR: [{ projectId: { in: [] } }, { siteId: { in: [] } }],
    });
  });

  it('uses the caller-named columns for a model with no site', () => {
    // The Project model itself: its own id is the project id, and it has no
    // siteId column, so naming one would be an invalid Prisma query rather than
    // a stricter one.
    expect(
      scopeWhere({ global: false, projectIds: ['p-1'], siteIds: ['s-9'] }, { project: 'id', site: null }),
    ).toEqual({ OR: [{ id: { in: ['p-1'] } }] });
  });

  it('denies a model that carries neither column', () => {
    // Returning `{}` here would hand a non-global user every row.
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: [] }, { project: null, site: null }))
      .toEqual({ id: { in: [] } });
  });

  it('ignores the field names for a global user', () => {
    expect(scopeWhere({ global: true, projectIds: [], siteIds: [] }, { project: null, site: null })).toEqual({});
  });
});
