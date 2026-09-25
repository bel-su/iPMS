import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const createUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const updateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const deactivateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const reactivateUser = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const setUserRoles = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const resetUserPassword = vi.fn().mockResolvedValue({ state: 'ready', data: { id: 'u-1' } });
const changePassword = vi.fn().mockResolvedValue({ state: 'ready', data: { status: 'ok' } });
vi.mock('../lib/user-api', () => ({
  createUser, updateUser, deactivateUser, reactivateUser,
  setUserRoles, resetUserPassword, changePassword,
  listUsers: vi.fn(), getUser: vi.fn(), listRoles: vi.fn(),
}));

const {
  changePasswordAction, createUserAction, deactivateUserAction,
  reactivateUserAction, resetUserPasswordAction, setUserRolesAction, updateUserAction,
} = await import('./actions');

beforeEach(() => {
  revalidatePath.mockClear();
  redirect.mockClear();
  for (const fn of [createUser, updateUser, deactivateUser, reactivateUser, setUserRoles, resetUserPassword, changePassword]) {
    fn.mockClear();
  }
});

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const NEW_USER = {
  username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
  password: 'a-long-enough-password', confirmPassword: 'a-long-enough-password',
};

describe('createUserAction', () => {
  it('sends the whole form, with the checked roles as an array', async () => {
    await expect(createUserAction({}, form({ ...NEW_USER, roleCodes: ['FIELD_ENGINEER', 'QC_MANAGER'] })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(createUser).toHaveBeenCalledWith({
      username: 'new.one', email: 'new.one@ipms.local', fullName: 'New One',
      password: 'a-long-enough-password', roleCodes: ['FIELD_ENGINEER', 'QC_MANAGER'],
    });
  });

  it('omits employeeCode when it was left blank rather than sending an empty string', async () => {
    await expect(createUserAction({}, form({ ...NEW_USER, employeeCode: '   ' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(createUser.mock.calls[0]![0]).not.toHaveProperty('employeeCode');
  });

  it('refuses a mismatched confirmation without a round trip', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, confirmPassword: 'something-else' })))
      .toEqual({ error: 'The two passwords do not match.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  // The service refuses it too, but a round trip to be told the obvious is a
  // worse answer than an immediate one.
  it('refuses a short password without a round trip', async () => {
    expect(await createUserAction({}, form({ ...NEW_USER, password: 'short', confirmPassword: 'short' })))
      .toEqual({ error: 'The password must be at least 12 characters.' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('requires a username, an email and a name', async () => {
    expect(await createUserAction({}, form({ username: 'only.this' })))
      .toEqual({ error: 'A username, an email address and a full name are required.' });
  });

  it('lands on the new users page', async () => {
    await expect(createUserAction({}, form(NEW_USER))).rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
    expect(redirect).toHaveBeenCalledWith('/users/u-1');
  });

  it('shows the APIs refusal and does not redirect', async () => {
    createUser.mockResolvedValueOnce({ state: 'forbidden', message: 'You may not assign the role SUPER_ADMIN' });
    expect(await createUserAction({}, form(NEW_USER)))
      .toEqual({ error: 'You may not assign the role SUPER_ADMIN' });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('updateUserAction', () => {
  it('clears employeeCode when the field is submitted empty', async () => {
    await expect(updateUserAction({}, form({
      userId: 'u-1', fullName: 'Renamed', email: 'r@ipms.local', employeeCode: '',
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(updateUser).toHaveBeenCalledWith('u-1', {
      fullName: 'Renamed', email: 'r@ipms.local', employeeCode: null,
    });
  });

  it('refreshes the list as well as the detail page, because both show the name', async () => {
    await expect(updateUserAction({}, form({ userId: 'u-1', fullName: 'Renamed', email: 'r@ipms.local' })))
      .rejects.toThrow('NEXT_REDIRECT');
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });
});

describe('setUserRolesAction', () => {
  // An unchecked box sends nothing, which is how the form says "no roles".
  it('sends the empty set when every box is unchecked', async () => {
    expect(await setUserRolesAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(setUserRoles).toHaveBeenCalledWith('u-1', { roleCodes: [] });
  });

  it('sends every checked role', async () => {
    await setUserRolesAction({}, form({ userId: 'u-1', roleCodes: ['QC_MANAGER'] }));
    expect(setUserRoles).toHaveBeenCalledWith('u-1', { roleCodes: ['QC_MANAGER'] });
  });
});

describe('deactivateUserAction and reactivateUserAction', () => {
  it('deactivates and refreshes both pages', async () => {
    expect(await deactivateUserAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(deactivateUser).toHaveBeenCalledWith('u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users/u-1');
    expect(revalidatePath).toHaveBeenCalledWith('/users');
  });

  it('surfaces the last-administrator refusal rather than swallowing it', async () => {
    deactivateUser.mockResolvedValueOnce({
      state: 'unavailable', status: 400,
      message: 'This is the last active super administrator; promote another account first',
    });
    expect(await deactivateUserAction({}, form({ userId: 'u-1' })))
      .toEqual({ error: 'This is the last active super administrator; promote another account first' });
  });

  it('reactivates', async () => {
    expect(await reactivateUserAction({}, form({ userId: 'u-1' }))).toEqual({});
    expect(reactivateUser).toHaveBeenCalledWith('u-1');
  });
});

describe('resetUserPasswordAction', () => {
  it('sends the new password once both copies agree', async () => {
    expect(await resetUserPasswordAction({}, form({
      userId: 'u-1', password: 'a-long-enough-password', confirmPassword: 'a-long-enough-password',
    }))).toEqual({});
    expect(resetUserPassword).toHaveBeenCalledWith('u-1', { password: 'a-long-enough-password' });
  });

  it('refuses a mismatch without a round trip', async () => {
    expect(await resetUserPasswordAction({}, form({
      userId: 'u-1', password: 'a-long-enough-password', confirmPassword: 'different-enough-one',
    }))).toEqual({ error: 'The two passwords do not match.' });
    expect(resetUserPassword).not.toHaveBeenCalled();
  });
});

describe('changePasswordAction', () => {
  /**
   * The change bumps tokenVersion, so the cookie in this browser is already
   * dead by the time the action returns. Signing out locally and going to the
   * login page is the only coherent next screen.
   */
  it('sends the user to sign in again', async () => {
    await expect(changePasswordAction({}, form({
      currentPassword: 'old-password', newPassword: 'a-long-enough-password',
      confirmPassword: 'a-long-enough-password',
    }))).rejects.toThrow('NEXT_REDIRECT');
    expect(changePassword).toHaveBeenCalledWith({
      currentPassword: 'old-password', newPassword: 'a-long-enough-password',
    });
    expect(redirect).toHaveBeenCalledWith('/login?changed=1');
  });

  it('refuses a new password equal to the current one without a round trip', async () => {
    expect(await changePasswordAction({}, form({
      currentPassword: 'a-long-enough-password', newPassword: 'a-long-enough-password',
      confirmPassword: 'a-long-enough-password',
    }))).toEqual({ error: 'The new password must be different from the current one.' });
    expect(changePassword).not.toHaveBeenCalled();
  });
});
