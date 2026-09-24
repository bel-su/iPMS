import { describe, expect, it } from 'vitest';
import { endOfDayIso, isWorkOrderType, pageWindow, personLabel, taskKind, templatesFor, workOrderTitle } from './labels';

describe('workOrderTitle', () => {
  it('prefixes the site name with the type label', () => {
    expect(workOrderTitle('QUALITY_SELF_CHECK', 'SAKUWA GACHHI')).toBe('[Quality Self-check]SAKUWA GACHHI');
  });

  it('appends the creator’s addition after a space', () => {
    expect(workOrderTitle('EHS_SPOT_CHECK', 'KOS102X', '  sector 2 ')).toBe('[EHS Spot Check]KOS102X sector 2');
  });

  it('is empty until a site is chosen', () => {
    expect(workOrderTitle('EHS_SELF_CHECK', undefined, 'x')).toBe('');
  });

  it('never exceeds the 250 characters the service accepts', () => {
    expect(workOrderTitle('EHS_SELF_CHECK', 'S', 'x'.repeat(400))).toHaveLength(250);
  });
});

describe('templatesFor', () => {
  const templates = [{ id: 'q', category: 'QUALITY' as const }, { id: 'e', category: 'EHS' as const }, { id: 'o', category: 'OTHER' as const }];
  it('offers only templates of the type’s category', () => {
    expect(templatesFor('QUALITY_SPOT_CHECK', templates).map((t) => t.id)).toEqual(['q']);
    expect(templatesFor('EHS_SELF_CHECK', templates).map((t) => t.id)).toEqual(['e']);
  });
});

describe('endOfDayIso', () => {
  it('is the last second of that local day', () => {
    const iso = endOfDayIso('2026-09-30');
    expect(iso).not.toBeNull();
    const local = new Date(iso!);
    expect([local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), local.getMinutes(), local.getSeconds()]).toEqual([2026, 8, 30, 23, 59, 59]);
  });

  it('refuses anything that is not a date', () => {
    expect(endOfDayIso('')).toBeNull();
    expect(endOfDayIso('30/09/2026')).toBeNull();
  });
});

describe('isWorkOrderType', () => {
  it('accepts the four types and nothing else', () => {
    expect(isWorkOrderType('EHS_SPOT_CHECK')).toBe(true);
    expect(isWorkOrderType('CIVIL')).toBe(false);
    expect(isWorkOrderType(undefined)).toBe(false);
  });
});

describe('personLabel', () => {
  it('shows the employee code when there is one', () => {
    expect(personLabel({ fullName: 'Dipesh Adhikari', employeeCode: '6000059290' })).toBe('Dipesh Adhikari (6000059290)');
    expect(personLabel({ fullName: 'Dipesh Adhikari', employeeCode: null })).toBe('Dipesh Adhikari');
  });
});

describe('pageWindow', () => {
  it('shows every page when there are few', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
  });

  it('elides the gaps on both sides', () => {
    expect(pageWindow(50, 103)).toEqual([1, null, 48, 49, 50, 51, 52, null, 103]);
  });

  it('elides only the far side at the start', () => {
    expect(pageWindow(1, 103)).toEqual([1, 2, 3, null, 103]);
  });

  it('handles a single page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});

describe('taskKind', () => {
  const names = new Map([['tt-1', 'Civil']]);
  it('names the task type of an ordinary task', () => {
    expect(taskKind({ taskTypeId: 'tt-1', workOrderType: null }, names)).toBe('Civil');
  });
  it('names the work order type of a work order', () => {
    expect(taskKind({ taskTypeId: null, workOrderType: 'EHS_SPOT_CHECK' }, names)).toBe('EHS Spot Check');
  });
});
