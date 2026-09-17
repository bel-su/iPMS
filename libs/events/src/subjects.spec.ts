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
