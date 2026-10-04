import { describe, expect, it } from 'vitest';
import { searchScope } from './search-scope';

describe('searchScope', () => {
  it.each([
    ['/projects', '/projects', 'q'],
    ['/projects/p-1/sites', '/projects', 'q'],
    ['/users', '/users', 'search'],
    ['/users/u-1', '/users', 'search'],
    ['/quality/templates', '/quality/templates', 'q'],
    ['/quality/templates/t-1/draft', '/quality/templates', 'q'],
    ['/quality/work-orders', '/quality/work-orders', 'q'],
    ['/quality/work-orders/w-1', '/quality/work-orders', 'q'],
  ])('%s searches %s by ?%s', (pathname, action, field) => {
    expect(searchScope(pathname)).toMatchObject({ action, field });
  });

  it('falls back to work orders where a page has no list of its own', () => {
    for (const pathname of ['/', '/docs', '/profile']) expect(searchScope(pathname).action).toBe('/quality/work-orders');
  });

  it('does not mistake a longer path for a section', () => {
    expect(searchScope('/projects-archive').action).toBe('/quality/work-orders');
  });

  it('keeps the template tab and category so a search stays inside the tab being viewed', () => {
    expect(searchScope('/quality/templates').keep).toEqual(['tab', 'category']);
  });
});
