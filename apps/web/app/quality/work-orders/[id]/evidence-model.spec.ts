import { describe, expect, it } from 'vitest';
import { buildEvidence, distanceText, viewerKeyAction } from './evidence-model';

const fact = (id: string, patch: Record<string, unknown> = {}) => [id, { id, kind: 'PHOTO', capturedAt: '2026-09-30T08:00:00.000Z', distanceFromSiteM: 12, ...patch }] as const;

describe('buildEvidence', () => {
  it('orders by sequence and links through the same-origin media route', () => {
    const files = buildEvidence(
      { media: [{ id: 'r2', itemResponseId: 'x', mediaId: 'b', kind: 'VIDEO', sequence: 1 }, { id: 'r1', itemResponseId: 'x', mediaId: 'a', kind: 'PHOTO', sequence: 0 }] },
      new Map([fact('a'), fact('b', { kind: 'VIDEO', distanceFromSiteM: null })]) as never,
      null,
    );
    expect(files.map((f) => [f.id, f.kind, f.isNew])).toEqual([['a', 'PHOTO', false], ['b', 'VIDEO', false]]);
    expect(files[0]).toMatchObject({ thumbSrc: '/api/media/a/thumbnail', originalSrc: '/api/media/a/original', downloadSrc: '/api/media/a/download', distanceText: '12 m from site' });
    expect(files[1]!.distanceText).toBe('No location');
  });

  it('marks files not in the previous attempt as new', () => {
    const files = buildEvidence(
      { media: [{ id: 'r1', itemResponseId: 'x', mediaId: 'a', kind: 'PHOTO', sequence: 0 }, { id: 'r2', itemResponseId: 'x', mediaId: 'c', kind: 'PHOTO', sequence: 1 }] },
      new Map([fact('a'), fact('c')]) as never,
      new Set(['a']),
    );
    expect(files.map((f) => f.isNew)).toEqual([false, true]);
  });

  it('still lists a file media no longer describes, without facts', () => {
    const [file] = buildEvidence({ media: [{ id: 'r1', itemResponseId: 'x', mediaId: 'gone', kind: 'PHOTO', sequence: 0 }] }, new Map(), null);
    expect(file).toMatchObject({ id: 'gone', capturedAt: null, distanceText: 'No location' });
  });
});

describe('distanceText', () => {
  it('uses km beyond 1000 m', () => {
    expect(distanceText(1450)).toBe('1.5 km from site');
    expect(distanceText(0)).toBe('0 m from site');
  });
});

describe('viewerKeyAction', () => {
  it('closes on Escape and steps on arrows', () => {
    expect(viewerKeyAction('Escape', false)).toBe('close');
    expect(viewerKeyAction('ArrowRight', false)).toBe('next');
    expect(viewerKeyAction('ArrowLeft', false)).toBe('previous');
    expect(viewerKeyAction('a', false)).toBeNull();
  });
  it('leaves arrows to the video player but still closes on Escape', () => {
    expect(viewerKeyAction('ArrowRight', true)).toBeNull();
    expect(viewerKeyAction('ArrowLeft', true)).toBeNull();
    expect(viewerKeyAction('Escape', true)).toBe('close');
  });
});
