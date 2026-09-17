import { describe, expect, it } from 'vitest';
import { scopeWhere } from './scope-filter.js';

describe('scopeWhere', () => {
  it('returns an empty constraint for a global user', () => {
    expect(scopeWhere({ global: true, projectIds: [], siteIds: [] })).toEqual({});
  });

  it('constrains to the scoped projects and sites', () => {
    expect(scopeWhere({ global: false, projectIds: ['p-1', 'p-2'], siteIds: ['s-1'] })).toEqual({
      projectId: { in: ['p-1', 'p-2'] },
      siteId: { in: ['s-1'] },
    });
  });

  it('omits the site constraint when no sites are scoped', () => {
    expect(scopeWhere({ global: false, projectIds: ['p-1'], siteIds: [] })).toEqual({
      projectId: { in: ['p-1'] },
    });
  });

  it('matches nothing for a user with no scope at all', () => {
    expect(scopeWhere({ global: false, projectIds: [], siteIds: [] })).toEqual({
      projectId: { in: [] },
    });
  });
});
