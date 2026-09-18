import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

const svc = new PasswordService();

describe('PasswordService', () => {
  it('produces an argon2id hash', async () => {
    expect(await svc.hash('demo12345')).toMatch(/^\$argon2id\$/);
  });

  it('never returns the plaintext', async () => {
    expect(await svc.hash('demo12345')).not.toContain('demo12345');
  });

  it('salts, so the same password hashes differently each time', async () => {
    expect(await svc.hash('demo12345')).not.toBe(await svc.hash('demo12345'));
  });

  it('verifies a correct password', async () => {
    expect(await svc.verify(await svc.hash('demo12345'), 'demo12345')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    expect(await svc.verify(await svc.hash('demo12345'), 'wrong-password')).toBe(false);
  });

  it('returns false rather than throwing on a malformed hash', async () => {
    expect(await svc.verify('not-a-hash', 'demo12345')).toBe(false);
  });
});
