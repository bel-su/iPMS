import { describe, expect, it } from 'vitest';
import { projectScope, siteScope, viaProject, visibleProject, visibleTask } from './project-scope.js';

const A = 'p-a';
const SITE_IN_C = 's-c';

describe('projectScope', () => {
  it('is unconstrained for a global caller', () => {
    expect(projectScope({ global: true, projectIds: [], siteIds: [] })).toEqual({});
  });

  it('reaches a project through a site grant', () => {
    // Project and site grants are alternatives. A user scoped only to a site in
    // project C must still see project C, or that site is unreachable from
    // every list that starts at a project.
    expect(projectScope({ global: false, projectIds: [A], siteIds: [SITE_IN_C] })).toEqual({
      OR: [{ id: { in: [A] } }, { sites: { some: { id: { in: [SITE_IN_C] } } } }],
    });
  });

  it('matches nothing for a caller with no scope', () => {
    expect(projectScope({ global: false, projectIds: [], siteIds: [] })).toEqual({
      OR: [{ id: { in: [] } }, { sites: { some: { id: { in: [] } } } }],
    });
  });
});

describe('visibleProject', () => {
  it('ANDs the id with the visibility rule, so neither can be bypassed', () => {
    expect(visibleProject({ global: false, projectIds: [A], siteIds: [] }, A)).toEqual({
      AND: [{ id: A }, { OR: [{ id: { in: [A] } }, { sites: { some: { id: { in: [] } } } }] }],
    });
  });

  it('narrows to the id alone for a global caller', () => {
    expect(visibleProject({ global: true, projectIds: [], siteIds: [] }, A)).toEqual({
      AND: [{ id: A }, {}],
    });
  });
});

describe('siteScope', () => {
  it('admits a site by its project or by itself', () => {
    expect(siteScope({ global: false, projectIds: [A], siteIds: [SITE_IN_C] })).toEqual({
      OR: [{ projectId: { in: [A] } }, { id: { in: [SITE_IN_C] } }],
    });
  });

  it('matches nothing without scope', () => {
    expect(siteScope({ global: false, projectIds: [], siteIds: [] })).toEqual({
      OR: [{ projectId: { in: [] } }, { id: { in: [] } }],
    });
  });
});

describe('viaProject', () => {
  it('lets a site-scoped caller read their project\'s definition records', () => {
    // A task type or milestone filtered on its own projectId would be invisible
    // to a caller scoped only to a site, making their own site's work
    // unreadable -- they could open a task and not resolve the task type it
    // names. Going through the relation reuses the project rule, which already
    // treats a site grant as reaching its project.
    expect(viaProject({ global: false, projectIds: [], siteIds: [SITE_IN_C] })).toEqual({
      project: { OR: [{ id: { in: [] } }, { sites: { some: { id: { in: [SITE_IN_C] } } } }] },
    });
  });

  it('is unconstrained for a global caller', () => {
    expect(viaProject({ global: true, projectIds: [], siteIds: [] })).toEqual({ project: {} });
  });
});

describe('visibleTask', () => {
  it('admits a task by project or by site', () => {
    expect(visibleTask({ global: false, projectIds: [A], siteIds: [SITE_IN_C] }, 't-1')).toEqual({
      AND: [{ id: 't-1' }, { OR: [{ projectId: { in: [A] } }, { siteId: { in: [SITE_IN_C] } }] }],
    });
  });
});
