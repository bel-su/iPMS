import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '@ipms/authz';
import { uuidv7 } from '@ipms/contracts';
import { UsersController } from './users.controller.js';

const ID = uuidv7();
const ACTOR = uuidv7();

function build() {
  const users = {
    list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 }),
    directory: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue({ id: ID }),
    create: vi.fn().mockResolvedValue({ id: ID }),
    update: vi.fn().mockResolvedValue({ id: ID }),
    deactivate: vi.fn().mockResolvedValue({ id: ID }),
    reactivate: vi.fn().mockResolvedValue({ id: ID }),
    setRoles: vi.fn().mockResolvedValue({ id: ID }),
    resetPassword: vi.fn().mockResolvedValue({ id: ID }),
  };
  return { controller: new UsersController(users as never), users };
}

const req = { user: { id: ACTOR, roles: ['SUPER_ADMIN'], permissions: [], tokenVersion: 0, isActive: true } };

/** The decorator is the enforcement; a route that loses it is silently public to any signed-in caller. */
function permissionOf(method: keyof UsersController): string {
  return Reflect.getMetadata(PERMISSION_KEY, UsersController.prototype[method] as never)?.permission;
}

describe('UsersController permissions', () => {
  it('guards every route with the permission the catalog defines for it', () => {
    expect(permissionOf('list')).toBe('user.view');
    expect(permissionOf('get')).toBe('user.view');
    // Anyone who works with tasks needs assignee names; see UsersService.directory.
    expect(permissionOf('directory')).toBe('task.view');
    expect(permissionOf('create')).toBe('user.create');
    expect(permissionOf('update')).toBe('user.update');
    expect(permissionOf('deactivate')).toBe('user.deactivate');
    expect(permissionOf('reactivate')).toBe('user.update');
    expect(permissionOf('setRoles')).toBe('role.assign');
    expect(permissionOf('resetPassword')).toBe('user.update');
  });
});

describe('UsersController parsing', () => {
  it('coerces the list query a query string delivers as text', async () => {
    const { controller, users } = build();
    await controller.list({ page: '2', limit: '10', status: 'ACTIVE' });
    expect(users.list).toHaveBeenCalledWith({ page: 2, limit: 10, status: 'ACTIVE' });
  });

  it('passes the actor id and roles through to the service', async () => {
    const { controller, users } = build();
    await controller.create({
      email: 'new.one@ipms.local', fullName: 'New One',
      password: 'Correct-horse-1', roleCodes: ['FIELD_ENGINEER'],
    }, req);
    expect(users.create.mock.calls[0]![1]).toBe(ACTOR);
    expect(users.create.mock.calls[0]![2]).toEqual(['SUPER_ADMIN']);
  });

  it('refuses a malformed id rather than passing it to the database', async () => {
    const { controller } = build();
    await expect(controller.get('not-a-uuid')).rejects.toThrow();
  });

  it('refuses a body the schema rejects', async () => {
    const { controller } = build();
    await expect(controller.create({ email: 'x' }, req)).rejects.toThrow();
  });

  it('strips a client-supplied isActive rather than honouring it', async () => {
    const { controller, users } = build();
    await controller.create({
      email: 'new.one@ipms.local', fullName: 'New One',
      password: 'Correct-horse-1', roleCodes: [], isActive: false,
    }, req);
    expect(users.create.mock.calls[0]![0]).not.toHaveProperty('isActive');
  });
});

describe('UsersController.me', () => {
  it('reads the caller from the token, with no permission required', async () => {
    const { controller, users } = build();
    await controller.me(req);
    expect(users.get).toHaveBeenCalledWith(ACTOR);
    expect(permissionOf('me')).toBeUndefined();
  });
});
