import { describe, expect, it } from 'vitest';
import { userIdFrom } from './current-user.js';

describe('userIdFrom', () => {
  it('returns the verified token subject', () => {
    expect(userIdFrom({ user: { id: 'u-1' } })).toBe('u-1');
  });

  it('refuses a request the token guard did not populate', () => {
    expect(() => userIdFrom({})).toThrow('Authentication required');
  });
});
