import { describe, expect, it } from 'vitest';
import { resolveReportQuery, sumMoney } from './report-model';

describe('sumMoney', () => {
  it('adds in whole paisa so cents never drift', () => { expect(sumMoney(['0.10', '0.20'])).toBe('0.30'); });
  it('is zero for nothing', () => { expect(sumMoney([])).toBe('0.00'); });
  it('accepts amounts with fewer decimals', () => { expect(sumMoney(['1000', '250.75', '0.25'])).toBe('1251.00'); });
  it('stays exact beyond float precision', () => { expect(sumMoney(['999999999999.99', '0.01'])).toBe('1000000000000.00'); });
});

describe('resolveReportQuery', () => {
  it('keeps a known grouping and falls back to project otherwise', () => {
    expect(resolveReportQuery({ groupBy: 'category' }).groupBy).toBe('category');
    expect(resolveReportQuery({ groupBy: 'requester' }).groupBy).toBe('requester');
    expect(resolveReportQuery({ groupBy: 'bogus' }).groupBy).toBe('project');
    expect(resolveReportQuery({}).groupBy).toBe('project');
  });
  it('takes the first value of a repeated parameter', () => {
    expect(resolveReportQuery({ groupBy: ['category', 'project'] }).groupBy).toBe('category');
  });
  it('keeps well-formed dates and drops malformed ones', () => {
    expect(resolveReportQuery({ from: '2026-10-01', to: '2026-10-31' })).toEqual({ groupBy: 'project', from: '2026-10-01', to: '2026-10-31' });
    expect(resolveReportQuery({ from: '01/10/2026', to: 'x' })).toEqual({ groupBy: 'project' });
  });
});
