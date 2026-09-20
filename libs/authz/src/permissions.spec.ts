import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_CODES, expandDependencies, validatePermissionSet } from './permissions.js';

describe('permission catalog', () => {
  it('has no duplicate codes', () => {
    const codes = PERMISSIONS.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('derives every code as module.action', () => {
    for (const p of PERMISSIONS) {
      expect(p.code).toBe(`${p.module}.${p.action}`);
    }
  });

  it('references only known codes in dependsOn', () => {
    for (const p of PERMISSIONS) {
      for (const dep of p.dependsOn) {
        expect(PERMISSION_CODES.has(dep), `${p.code} depends on unknown ${dep}`).toBe(true);
      }
    }
  });

  it('never defines audit.update or audit.delete — the ledger is append-only', () => {
    expect(PERMISSION_CODES.has('audit.update')).toBe(false);
    expect(PERMISSION_CODES.has('audit.delete')).toBe(false);
  });

  it('has no dependency cycles', () => {
    for (const p of PERMISSIONS) {
      expect(() => expandDependencies([p.code])).not.toThrow();
    }
  });
});

describe('expandDependencies', () => {
  it('adds a direct dependency', () => {
    expect(expandDependencies(['qc_review.approve'])).toContain('qc_review.view');
  });

  it('adds transitive dependencies', () => {
    const expanded = expandDependencies(['task.assign']);
    expect(expanded).toContain('task.view');
    expect(expanded).toContain('task.update');
  });

  it('is idempotent', () => {
    const once = expandDependencies(['task.assign']);
    expect(expandDependencies(once).sort()).toEqual([...once].sort());
  });

  it('ignores unknown codes rather than throwing', () => {
    expect(expandDependencies(['not.a.permission'])).toEqual(['not.a.permission']);
  });
});

describe('validatePermissionSet', () => {
  it('rejects a role granting qc approve without qc review view', () => {
    const result = validatePermissionSet(['qc_review.approve']);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('qc_review.view');
  });

  it('accepts a dependency-complete set', () => {
    expect(validatePermissionSet(['qc_submission.view', 'qc_review.view', 'qc_review.approve']).valid).toBe(true);
  });

  it('accepts an empty set', () => {
    expect(validatePermissionSet([]).valid).toBe(true);
  });
});

describe('project.delete', () => {
  it('is in the catalogue', () => {
    expect(PERMISSIONS.map((p) => p.code)).toContain('project.delete');
  });

  it('depends on archive, so no role holds the irreversible power without the reversible one', () => {
    expect(expandDependencies(['project.delete']).sort())
      .toEqual(['project.archive', 'project.delete', 'project.update', 'project.view']);
  });
});

describe('site.import', () => {
  it('is in the catalogue', () => {
    expect(PERMISSION_CODES.has('site.import')).toBe(true);
  });

  // It overwrites existing sites, so bulk authority must not exceed the
  // one-at-a-time authority the holder already has.
  it('depends on site.update, not only site.create', () => {
    expect(expandDependencies(['site.import'])).toEqual(
      expect.arrayContaining(['site.view', 'site.create', 'site.update', 'project.view']),
    );
  });
});
