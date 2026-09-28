import { describe, expect, it } from 'vitest';
import { LOCKED, PRE_ATTACH, VIEWABLE } from './status.js';

describe('status groups', () => {
  it('lets retakes and cancellations remove only what is not in a submission', () => {
    expect([...PRE_ATTACH].sort()).toEqual(['PENDING', 'READY', 'REJECTED', 'VERIFYING']);
    for (const status of LOCKED) expect(PRE_ATTACH).not.toContain(status);
  });

  it('only serves verified, still-stored files', () => {
    expect([...VIEWABLE].sort()).toEqual(['ATTACHED', 'PURGE_SCHEDULED', 'READY']);
  });
});
