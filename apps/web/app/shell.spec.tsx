import { beforeEach, describe, expect, it, vi } from 'vitest';

const getCurrentUser = vi.fn();
vi.mock('./lib/iam-api', async () => {
  const actual = await vi.importActual<typeof import('./lib/iam-api')>('./lib/iam-api');
  return { ...actual, getCurrentUser };
});

const { Sidebar } = await import('./shell');

function user(permissions: string[]) {
  return { state: 'ready', data: { id: 'u-1', roles: [], permissions, tokenVersion: 0, isActive: true } };
}

/** Walks the rendered tree for every `href` an anchor carries. */
function hrefs(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const element = node as { props?: { href?: string; children?: unknown } };
  const here = typeof element.props?.href === 'string' ? [element.props.href] : [];
  const children = element.props?.children;
  const list = Array.isArray(children) ? children : [children];
  return [...here, ...list.flatMap(hrefs)];
}

beforeEach(() => getCurrentUser.mockReset());

describe('Sidebar', () => {
  it('offers Users to a viewer who may see them', async () => {
    getCurrentUser.mockResolvedValue(user(['user.view', 'project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).toContain('/users');
  });

  // Hiding it is UX, not a boundary — /users still renders a forbidden state
  // for anyone who reaches it directly.
  it('hides Users from a viewer who may not', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/users');
  });

  it('still renders the rest of the navigation when the identity call fails', async () => {
    getCurrentUser.mockResolvedValue({ state: 'unavailable', status: 503, message: 'down' });
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links).toContain('/projects');
    expect(links).not.toContain('/users');
  });

  it('hides Users from a deactivated account even if the claim still lists the permission', async () => {
    getCurrentUser.mockResolvedValue({
      state: 'ready',
      data: { id: 'u-1', roles: [], permissions: ['user.view'], tokenVersion: 0, isActive: false },
    });
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/users');
  });

  it('groups the checklist library and work orders under Quality & EHS', async () => {
    getCurrentUser.mockResolvedValue(user(['qc_template.view', 'task.view']));
    const links = hrefs(await Sidebar({ active: 'work-orders' }));
    expect(links).toEqual(expect.arrayContaining(['/quality/templates', '/quality/work-orders']));
    expect(links).not.toContain('/work-orders');
  });

  it('offers the checklist library only to a viewer who may see templates', async () => {
    getCurrentUser.mockResolvedValue(user(['task.view']));
    expect(hrefs(await Sidebar({ active: 'projects' }))).not.toContain('/quality/templates');
    getCurrentUser.mockResolvedValue(user(['qc_template.view']));
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links).toContain('/quality/templates');
    expect(links).not.toContain('/quality/work-orders');
  });

  it('hides the whole group from a viewer who may see neither', async () => {
    getCurrentUser.mockResolvedValue(user(['project.view']));
    const links = hrefs(await Sidebar({ active: 'projects' }));
    expect(links.some((href) => href.startsWith('/quality'))).toBe(false);
  });
});
