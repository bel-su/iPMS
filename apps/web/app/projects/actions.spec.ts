import { beforeEach, describe, expect, it, vi } from 'vitest';

const revalidatePath = vi.fn();
const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT'); });
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect }));

const { settle } = await import('./settle');

beforeEach(() => { revalidatePath.mockClear(); redirect.mockClear(); });

describe('settle', () => {
  it('revalidates and returns no error when the call succeeded', async () => {
    expect(await settle({ state: 'ready', data: {} }, '/projects')).toEqual({});
    expect(revalidatePath).toHaveBeenCalledWith('/projects');
  });

  it('returns the message when the user may not do this', async () => {
    const state = await settle({ state: 'forbidden', message: 'Not allowed' }, '/projects');
    expect(state.error).toBe('Not allowed');
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('keeps the correlation id when the API is unavailable, so a refusal can be traced', async () => {
    const state = await settle(
      { state: 'unavailable', status: 409, message: 'Still has 3 tasks.', correlationId: 'corr-1' },
      '/projects',
    );
    expect(state).toEqual({ error: 'Still has 3 tasks.', correlationId: 'corr-1' });
  });

  it('sends an unauthenticated caller to sign in rather than showing an error', async () => {
    await expect(settle({ state: 'unauthenticated' }, '/projects')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });
});
