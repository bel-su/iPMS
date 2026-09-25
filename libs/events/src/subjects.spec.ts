import { describe, expect, it } from 'vitest';
import { SUBJECTS, STREAMS } from './subjects.js';

describe('subject catalog', () => {
  it('names every subject as service.entity.action', () => {
    for (const subject of Object.values(SUBJECTS)) {
      expect(subject).toMatch(/^[a-z]+\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it('has no duplicate subject strings', () => {
    const values = Object.values(SUBJECTS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('routes the audit stream to exactly one durable consumer', () => {
    expect(STREAMS.AUDIT.subjects).toEqual(['audit.event.recorded']);
    expect(STREAMS.AUDIT.durableConsumers).toEqual(['audit-ledger-writer']);
  });

  it('covers every subject with exactly one stream', () => {
    const covered = Object.values(STREAMS).flatMap((s) => s.subjects);
    for (const subject of Object.values(SUBJECTS)) {
      const matches = covered.filter((c) => c === subject || (c.endsWith('.>') && subject.startsWith(c.slice(0, -2))));
      expect(matches.length, `subject ${subject} must map to one stream`).toBe(1);
    }
  });
});

describe('durable naming', () => {
  it('gives each IAM subject project consumes its own durable', () => {
    // A durable carries ONE filter_subject. Sharing a durable across subjects
    // silently keeps only the first filter and drops the rest, which is how
    // revocations stopped replicating while grants kept working.
    for (const name of ['project-scope-granted', 'project-scope-revoked', 'project-scope-deactivated']) {
      expect(STREAMS.IAM.durableConsumers).toContain(name);
    }
  });

  it('no longer declares the single shared durable', () => {
    expect(STREAMS.IAM.durableConsumers).not.toContain('project-scope-cache');
  });

  it('declares every durable name only once', () => {
    const names = Object.values(STREAMS).flatMap((s) => s.durableConsumers);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('QC stream', () => {
  it('carries the submission subjects to one durable each for project', () => {
    expect(STREAMS.QC.subjects).toEqual(['qc.>']);
    expect(STREAMS.QC.durableConsumers).toEqual([]);
  });
});
