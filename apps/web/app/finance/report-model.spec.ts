import { describe, expect, it } from 'vitest';
import { sumMoney } from './report-model';

describe('sumMoney', () => {
  it('adds in whole paisa so cents never drift', () => { expect(sumMoney(['0.10', '0.20'])).toBe('0.30'); });
  it('is zero for nothing', () => { expect(sumMoney([])).toBe('0.00'); });
  it('accepts amounts with fewer decimals', () => { expect(sumMoney(['1000', '250.75', '0.25'])).toBe('1251.00'); });
  it('stays exact beyond float precision', () => { expect(sumMoney(['999999999999.99', '0.01'])).toBe('1000000000000.00'); });
});
