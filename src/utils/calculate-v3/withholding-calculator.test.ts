import { describe, it, expect } from 'vitest';
import { WithholdingCalculator } from './withholding-calculator';

/**
 * Mock bracket lookup: simplified 2024 brackets for testing
 * - MFJ: 10% on $0-23.2K, 12% on 23.2K-94.3K, 22% on 94.3K-201K, 24% on 201K-383.9K, 32% on 383.9K+
 * - Single: 10% on $0-11.6K, 12% on 11.6K-47.15K, 22% on 47.15K-100.525K, 24% on 100.525K-191.95K, 32% on 191.95K+
 */
const mockBracketLookup = (
  taxableIncome: number,
  filingStatus: string,
  year: number,
): number => {
  if (filingStatus === 'mfj') {
    let tax = 0;
    const brackets = [
      { limit: 23200, rate: 0.1 },
      { limit: 94300, rate: 0.12 },
      { limit: 201050, rate: 0.22 },
      { limit: 383900, rate: 0.24 },
      { limit: Infinity, rate: 0.32 },
    ];
    let remaining = taxableIncome;
    let prevLimit = 0;
    for (const b of brackets) {
      const taxableAmount = Math.min(remaining, b.limit - prevLimit);
      if (taxableAmount <= 0) break;
      tax += taxableAmount * b.rate;
      remaining -= taxableAmount;
      prevLimit = b.limit;
    }
    return tax;
  }
  // Single brackets (simplified)
  let tax = 0;
  const brackets = [
    { limit: 11600, rate: 0.1 },
    { limit: 47150, rate: 0.12 },
    { limit: 100525, rate: 0.22 },
    { limit: 191950, rate: 0.24 },
    { limit: Infinity, rate: 0.32 },
  ];
  let remaining = taxableIncome;
  let prevLimit = 0;
  for (const b of brackets) {
    const taxableAmount = Math.min(remaining, b.limit - prevLimit);
    if (taxableAmount <= 0) break;
    tax += taxableAmount * b.rate;
    remaining -= taxableAmount;
    prevLimit = b.limit;
  }
  return tax;
};

describe('WithholdingCalculator', () => {
  describe('computeFederalWithholding', () => {
    it('MFJ: $150K salary biweekly → ~$615/paycheck (within 10%)', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 150000;
      const periodsPerYear = 26; // biweekly
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 29200; // 2024 MFJ
      const filingStatus = 'mfj';
      const year = 2024;

      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        undefined,
        year,
        standardDeduction,
        mockBracketLookup,
      );

      // Expected: taxable income $120.8K, tax ~$16K, per paycheck ~$615
      expect(withholding).toBeGreaterThan(550);
      expect(withholding).toBeLessThan(680);
    });

    it('Single: $75K salary biweekly → ~$323/paycheck (within 10%)', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 75000;
      const periodsPerYear = 26; // biweekly
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 14600; // 2024 Single
      const filingStatus = 'single';
      const year = 2024;

      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        undefined,
        year,
        standardDeduction,
        mockBracketLookup,
      );

      // Expected: taxable income $60.4K, tax ~$8.4K, per paycheck ~$323
      expect(withholding).toBeGreaterThan(290);
      expect(withholding).toBeLessThan(356);
    });

    it('Extra withholding: $100/paycheck added', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 100000;
      const periodsPerYear = 26;
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 29200;
      const filingStatus = 'mfj';
      const year = 2024;

      const withoutExtra = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        undefined,
        year,
        standardDeduction,
        mockBracketLookup,
      );

      const withExtra = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        { filingStatus: 'mfj', extraWithholding: 100 },
        year,
        standardDeduction,
        mockBracketLookup,
      );

      expect(withExtra).toBe(withoutExtra + 100);
    });

    it('Multiple jobs: uses single brackets (higher withholding)', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 100000;
      const periodsPerYear = 26;
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 29200;
      const filingStatus = 'mfj';
      const year = 2024;

      const withoutMultiple = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        undefined,
        year,
        standardDeduction,
        mockBracketLookup,
      );

      const withMultiple = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        { filingStatus: 'mfj', multipleJobs: true },
        year,
        standardDeduction,
        mockBracketLookup,
      );

      // Multiple jobs should use single brackets, which have lower thresholds → higher withholding
      expect(withMultiple).toBeGreaterThan(withoutMultiple);
    });

    it('Monthly pay periods: 12 periods per year', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 60000;
      const periodsPerYear = 12; // monthly
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 14600;
      const filingStatus = 'single';
      const year = 2024;

      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        undefined,
        year,
        standardDeduction,
        mockBracketLookup,
      );

      // Taxable: $60K - $14.6K = $45.4K, tax ~$5.2K, monthly ~$435
      expect(withholding).toBeGreaterThan(410);
      expect(withholding).toBeLessThan(460);
    });

    it('Zero wages → zero withholding', () => {
      const calc = new WithholdingCalculator(null, 0);
      const withholding = calc.computeFederalWithholding(
        0,
        26,
        'mfj',
        undefined,
        2024,
        29200,
        mockBracketLookup,
      );
      expect(withholding).toBe(0);
    });

    it('Wages below standard deduction → zero withholding', () => {
      const calc = new WithholdingCalculator(null, 0);
      const taxableWagesPerPeriod = 500; // $13K/year (below $14.6K single deduction)
      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        26,
        'single',
        undefined,
        2024,
        14600,
        mockBracketLookup,
      );
      expect(withholding).toBe(0);
    });

    it('Combination: multiple jobs + extra withholding', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 100000;
      const periodsPerYear = 26;
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 29200;
      const filingStatus = 'mfj';
      const year = 2024;

      const combined = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        filingStatus,
        { filingStatus: 'mfj', multipleJobs: true, extraWithholding: 50 },
        year,
        standardDeduction,
        mockBracketLookup,
      );

      // Should include both the multiple jobs effect AND the extra withholding
      expect(combined).toBeGreaterThan(0);
    });

    it('setCurrentDate: tracks simulation date in logs', () => {
      const calc = new WithholdingCalculator(null, 0);
      calc.setCurrentDate('2024-01-15');
      const withholding = calc.computeFederalWithholding(
        5769, // $150K biweekly
        26,
        'mfj',
        undefined,
        2024,
        29200,
        mockBracketLookup,
      );
      expect(withholding).toBeGreaterThan(0);
    });
  });

  describe('computeBonusWithholding', () => {
    it('Bonus: 22% flat rate on $10,000 bonus = $2,200', () => {
      const calc = new WithholdingCalculator(null, 0);
      const bonusGross = 10000;
      const preTaxDeductions = 0;
      const withholding = calc.computeBonusWithholding(bonusGross, preTaxDeductions);
      expect(withholding).toBe(2200);
    });

    it('Bonus with pre-tax deductions: applied to net amount', () => {
      const calc = new WithholdingCalculator(null, 0);
      const bonusGross = 10000;
      const preTaxDeductions = 500; // e.g., 401k
      const withholding = calc.computeBonusWithholding(bonusGross, preTaxDeductions);
      // ($10K - $500) * 0.22 = $9,500 * 0.22 = $2,090
      expect(withholding).toBe(2090);
    });

    it('Bonus: zero when bonus is zero', () => {
      const calc = new WithholdingCalculator(null, 0);
      const withholding = calc.computeBonusWithholding(0, 0);
      expect(withholding).toBe(0);
    });

    it('Bonus: never negative', () => {
      const calc = new WithholdingCalculator(null, 0);
      // Deductions greater than bonus should not produce negative withholding
      const withholding = calc.computeBonusWithholding(1000, 5000);
      expect(withholding).toBeGreaterThanOrEqual(0);
    });

    it('Large bonus: 22% flat rate on $50,000', () => {
      const calc = new WithholdingCalculator(null, 0);
      const withholding = calc.computeBonusWithholding(50000, 0);
      expect(withholding).toBe(11000);
    });
  });

  describe('edge cases', () => {
    it('Very low taxable income (just above deduction)', () => {
      const calc = new WithholdingCalculator(null, 0);
      const standardDeduction = 14600;
      const taxableWagesPerPeriod = 600; // ~$15.6K/year
      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        26,
        'single',
        undefined,
        2024,
        standardDeduction,
        mockBracketLookup,
      );
      expect(withholding).toBeGreaterThanOrEqual(0);
      expect(withholding).toBeLessThan(100);
    });

    it('High income: tests higher brackets', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 400000;
      const periodsPerYear = 26;
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 29200;
      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        'mfj',
        undefined,
        2024,
        standardDeduction,
        mockBracketLookup,
      );
      // Should be significantly higher due to 24% and 32% brackets
      expect(withholding).toBeGreaterThan(2000);
    });

    it('HOH filing status (pass-through to bracket lookup)', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 100000;
      const periodsPerYear = 26;
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 21900; // 2024 HOH (approximate)
      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        'hoh',
        undefined,
        2024,
        standardDeduction,
        mockBracketLookup,
      );
      // Should compute without error (even though mockBracketLookup defaults to single for HOH)
      expect(withholding).toBeGreaterThan(0);
    });

    it('MFS filing status (pass-through to bracket lookup)', () => {
      const calc = new WithholdingCalculator(null, 0);
      const annualSalary = 100000;
      const periodsPerYear = 26;
      const taxableWagesPerPeriod = annualSalary / periodsPerYear;
      const standardDeduction = 14600; // 2024 MFS (same as single)
      const withholding = calc.computeFederalWithholding(
        taxableWagesPerPeriod,
        periodsPerYear,
        'mfs',
        undefined,
        2024,
        standardDeduction,
        mockBracketLookup,
      );
      // Should compute without error
      expect(withholding).toBeGreaterThan(0);
    });
  });

  describe('integration: realistic scenarios', () => {
    it('Scenario: $100K MFJ, biweekly, no adjustments', () => {
      const calc = new WithholdingCalculator(null, 0);
      const withholding = calc.computeFederalWithholding(
        100000 / 26,
        26,
        'mfj',
        undefined,
        2024,
        29200,
        mockBracketLookup,
      );
      // Annual: $100K - $29.2K = $70.8K → tax ~$7.5K → paycheck ~$288
      expect(withholding).toBeGreaterThan(260);
      expect(withholding).toBeLessThan(320);
    });

    it('Scenario: $75K single, monthly, extra $100', () => {
      const calc = new WithholdingCalculator(null, 0);
      const withholding = calc.computeFederalWithholding(
        75000 / 12,
        12,
        'single',
        { filingStatus: 'single', extraWithholding: 100 },
        2024,
        14600,
        mockBracketLookup,
      );
      // Base: $75K - $14.6K = $60.4K → tax ~$8.4K → monthly ~$700
      // Plus $100 = ~$800
      expect(withholding).toBeGreaterThan(700);
      expect(withholding).toBeLessThan(850);
    });

    it('Scenario: $200K MFJ, biweekly, multiple jobs', () => {
      const calc = new WithholdingCalculator(null, 0);
      const withholding = calc.computeFederalWithholding(
        200000 / 26,
        26,
        'mfj',
        { filingStatus: 'mfj', multipleJobs: true },
        2024,
        29200,
        mockBracketLookup,
      );
      // With multiple jobs flag, should use single brackets → higher withholding
      expect(withholding).toBeGreaterThan(1000);
    });
  });
});
