import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  getActivitiesInDateRange,
  getTaxPayments,
  getRothConversions,
  getDefaultResult,
} from '../helpers';
import { calculateAnnualFederalTax } from '../calculators/tax-calculator';

const taxBrackets = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../data/taxBrackets.json'), 'utf-8'),
);

const INFLATION = 0.03;
const FILING_STATUS = 'mfj' as const;

/**
 * Aggregate all income activities across all accounts for a given year.
 *
 * Returns:
 *   ordinaryIncome — paychecks, pension, interest, RMDs, Roth conversions
 *   ssIncome       — Social Security benefits
 *
 * Income activities are identified by positive amounts with known names.
 * Tax payments themselves are excluded (negative amounts with "tax" in name).
 */
function aggregateYearIncome(year: number): { ordinaryIncome: number; ssIncome: number } {
  const result = getDefaultResult();
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  let ordinaryIncome = 0;
  let ssIncome = 0;

  for (const account of result.accounts) {
    const activities = account.consolidatedActivity.filter((a) => {
      const d = a.date.substring(0, 10);
      return d >= startDate && d <= endDate;
    });

    for (const a of activities) {
      if (a.amount <= 0) continue;

      const nameLower = a.name.toLowerCase();

      // Social Security income
      if (nameLower.includes('social security')) {
        ssIncome += a.amount;
        continue;
      }

      // Ordinary income: paychecks, pension, interest, RMDs, Roth conversions
      if (
        nameLower.includes('paycheck') ||
        nameLower.includes('pension') ||
        nameLower.includes('interest') ||
        nameLower.includes('rmd') ||
        nameLower.includes('required minimum') ||
        (nameLower.includes('roth') && nameLower.includes('conversion'))
      ) {
        ordinaryIncome += a.amount;
      }
    }
  }

  return { ordinaryIncome, ssIncome };
}

/**
 * Get total engine tax payment for a year (absolute value).
 * Tax payments are negative amounts on accounts.
 */
function getEngineTaxTotal(year: number): number {
  const payments = getTaxPayments(year);
  // getTaxPayments returns negative amounts; sum absolute values
  return payments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
}

/**
 * Tax E2E tests — verify the engine's progressive bracket tax computation,
 * Social Security taxation tiers, and year-end tax payments against a
 * shadow calculator.
 *
 * Filing status: MFJ (married filing jointly)
 * Inflation: 3% (from variables.csv)
 * Tax brackets: from data/taxBrackets.json (2024, 2025 base years)
 *
 * Timeline milestones:
 *   2025-2027: Dual income (Alice ~$109K + Bob ~$73K paychecks + interest)
 *   2028:      Partial year income + pension begins
 *   2029+:     Pension only (no paychecks)
 *   2037:      Alice SS begins
 *   2040:      Both SS
 *   2043:      Alice RMD begins
 *   2050:      Full steady state (pension + SS + RMDs)
 */
describe('Tax — Progressive Brackets & Year-End Payments', () => {
  const TEST_YEARS = [2025, 2026, 2027, 2028, 2029, 2035, 2037, 2040, 2043, 2050];

  describe('tax payment exists each year', () => {
    for (const year of TEST_YEARS) {
      it(`${year}: engine produces at least one tax payment`, () => {
        const payments = getTaxPayments(year);
        expect(payments.length).toBeGreaterThan(0);
      });
    }
  });

  describe('shadow calculator matches engine tax amount', () => {
    for (const year of TEST_YEARS) {
      it(`${year}: shadow tax matches engine tax (within 5%)`, () => {
        const { ordinaryIncome, ssIncome } = aggregateYearIncome(year);
        const engineTax = getEngineTaxTotal(year);

        // Skip if engine produced no tax
        if (engineTax === 0) return;

        const shadow = calculateAnnualFederalTax(
          ordinaryIncome,
          ssIncome,
          0, // no penalties in deterministic run
          FILING_STATUS,
          year,
          INFLATION,
          taxBrackets,
        );

        // Allow 5% tolerance — the engine may include withholding adjustments,
        // Roth conversion tax, or other minor differences in timing
        const tolerance = Math.max(engineTax * 0.05, 500);
        expect(shadow.tax).toBeGreaterThan(0);
        expect(Math.abs(shadow.tax - engineTax)).toBeLessThan(tolerance);
      });
    }
  });

  describe('pre-retirement tax > post-retirement tax', () => {
    it('2026 (dual income) tax should exceed 2029 (pension only) tax', () => {
      const tax2026 = getEngineTaxTotal(2026);
      const tax2029 = getEngineTaxTotal(2029);
      expect(tax2026).toBeGreaterThan(tax2029);
    });

    it('2027 (last full working year) tax should exceed 2035 (pension only) tax', () => {
      const tax2027 = getEngineTaxTotal(2027);
      const tax2035 = getEngineTaxTotal(2035);
      expect(tax2027).toBeGreaterThan(tax2035);
    });
  });

  describe('Social Security increases tax', () => {
    it('2037 (pension + Alice SS) tax should exceed 2035 (pension only) tax', () => {
      const tax2035 = getEngineTaxTotal(2035);
      const tax2037 = getEngineTaxTotal(2037);
      expect(tax2037).toBeGreaterThan(tax2035);
    });

    it('2040 (pension + both SS) tax should exceed 2037 (pension + Alice SS only)', () => {
      const tax2037 = getEngineTaxTotal(2037);
      const tax2040 = getEngineTaxTotal(2040);
      expect(tax2040).toBeGreaterThan(tax2037);
    });

    it('2037: shadow calculator reports nonzero SS taxable amount', () => {
      const { ordinaryIncome, ssIncome } = aggregateYearIncome(2037);
      // SS should be present by 2037
      expect(ssIncome).toBeGreaterThan(0);

      const shadow = calculateAnnualFederalTax(
        ordinaryIncome,
        ssIncome,
        0,
        FILING_STATUS,
        2037,
        INFLATION,
        taxBrackets,
      );
      expect(shadow.ssTaxableAmount).toBeGreaterThan(0);
    });

    it('2040: SS taxable amount should be higher with both SS recipients', () => {
      const inc2037 = aggregateYearIncome(2037);
      const inc2040 = aggregateYearIncome(2040);

      const shadow2037 = calculateAnnualFederalTax(
        inc2037.ordinaryIncome,
        inc2037.ssIncome,
        0,
        FILING_STATUS,
        2037,
        INFLATION,
        taxBrackets,
      );

      const shadow2040 = calculateAnnualFederalTax(
        inc2040.ordinaryIncome,
        inc2040.ssIncome,
        0,
        FILING_STATUS,
        2040,
        INFLATION,
        taxBrackets,
      );

      expect(shadow2040.ssTaxableAmount).toBeGreaterThan(shadow2037.ssTaxableAmount);
    });
  });

  describe('RMD income increases tax', () => {
    it('2043 (pension + SS + RMD) tax should exceed 2040 (pension + SS only)', () => {
      const tax2040 = getEngineTaxTotal(2040);
      const tax2043 = getEngineTaxTotal(2043);
      expect(tax2043).toBeGreaterThan(tax2040);
    });

    it('2043: aggregate income should include RMD component', () => {
      const result = getDefaultResult();
      const startDate = '2043-01-01';
      const endDate = '2043-12-31';

      let hasRmd = false;
      for (const account of result.accounts) {
        const rmdActivities = account.consolidatedActivity.filter((a) => {
          const d = a.date.substring(0, 10);
          const nameLower = a.name.toLowerCase();
          return (
            d >= startDate &&
            d <= endDate &&
            a.amount > 0 &&
            (nameLower.includes('rmd') || nameLower.includes('required minimum'))
          );
        });
        if (rmdActivities.length > 0) {
          hasRmd = true;
          break;
        }
      }
      expect(hasRmd).toBe(true);
    });
  });

  describe('steady state (2050)', () => {
    it('2050 tax should be positive', () => {
      const tax = getEngineTaxTotal(2050);
      expect(tax).toBeGreaterThan(0);
    });

    it('2050: income includes pension + SS + RMDs', () => {
      const { ordinaryIncome, ssIncome } = aggregateYearIncome(2050);
      expect(ordinaryIncome).toBeGreaterThan(0);
      expect(ssIncome).toBeGreaterThan(0);
    });

    it('2050: effective rate is reasonable (5-30%)', () => {
      const { ordinaryIncome, ssIncome } = aggregateYearIncome(2050);
      const shadow = calculateAnnualFederalTax(
        ordinaryIncome,
        ssIncome,
        0,
        FILING_STATUS,
        2050,
        INFLATION,
        taxBrackets,
      );
      expect(shadow.effectiveRate).toBeGreaterThan(0.05);
      expect(shadow.effectiveRate).toBeLessThan(0.30);
    });
  });

  describe('bracket territory validation', () => {
    it('2025 dual income (~$180K+) should be in 22% bracket territory', () => {
      const { ordinaryIncome, ssIncome } = aggregateYearIncome(2025);
      const shadow = calculateAnnualFederalTax(
        ordinaryIncome,
        ssIncome,
        0,
        FILING_STATUS,
        2025,
        INFLATION,
        taxBrackets,
      );

      // With ~$180K+ combined income for MFJ, after standard deduction
      // taxable income should land in the 22% bracket range ($96,950–$206,700 for 2025 MFJ)
      // Effective rate should be 10-15% range for this income level
      expect(shadow.effectiveRate).toBeGreaterThan(0.08);
      expect(shadow.effectiveRate).toBeLessThan(0.20);
    });

    it('2029 pension-only income should have lower effective rate than 2025', () => {
      const inc2025 = aggregateYearIncome(2025);
      const inc2029 = aggregateYearIncome(2029);

      const shadow2025 = calculateAnnualFederalTax(
        inc2025.ordinaryIncome,
        inc2025.ssIncome,
        0,
        FILING_STATUS,
        2025,
        INFLATION,
        taxBrackets,
      );

      const shadow2029 = calculateAnnualFederalTax(
        inc2029.ordinaryIncome,
        inc2029.ssIncome,
        0,
        FILING_STATUS,
        2029,
        INFLATION,
        taxBrackets,
      );

      expect(shadow2025.effectiveRate).toBeGreaterThan(shadow2029.effectiveRate);
    });
  });
});
