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
 *   ordinaryIncome — paychecks, pension, RMDs, Roth conversions, taxable withdrawals
 *   ssIncome       — Social Security benefits
 *
 * Income activities are identified by positive amounts with known names.
 * Tax payments themselves are excluded (negative amounts).
 *
 * Note: Interest is excluded because no accounts have interestPayAccount set,
 * so the engine does not generate taxable occurrences for interest income.
 *
 * Roth conversions ARE included because the engine records them as 'retirement'
 * income type via TaxManager (key: __roth_conversion__) and they flow through
 * the normal bracket calculation in calculateTotalTaxOwed().
 *
 * Auto-pull withdrawals from deferred accounts (401k) are taxable because the
 * engine's processTransferEvent records them as 'retirement' income type.
 * We identify these by name pattern "Auto Pull from [deferred account]".
 */
// Deferred accounts whose withdrawals are taxable
const DEFERRED_ACCOUNTS = ['Alice 401(k)', 'Bob 401(k)'];

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

      // Ordinary income: paychecks, pension, RMDs, Roth conversions
      // Note: Interest excluded — engine does not tax it (no interestPayAccount configured)
      if (
        nameLower.includes('paycheck') ||
        nameLower.includes('pension') ||
        nameLower.includes('rmd') ||
        nameLower.includes('required minimum') ||
        (nameLower.includes('roth') && nameLower.includes('conversion'))
      ) {
        ordinaryIncome += a.amount;
        continue;
      }

      // Auto-pull withdrawals from deferred (tax-deferred) accounts are taxable
      // The engine records these as 'retirement' income in processTransferEvent
      if (nameLower.includes('auto pull')) {
        const isFromDeferred = DEFERRED_ACCOUNTS.some(
          (acctName) => a.name.includes(acctName),
        );
        if (isFromDeferred) {
          ordinaryIncome += a.amount;
        }
      }
    }
  }

  return { ordinaryIncome, ssIncome };
}

/**
 * Get engine's tax payment for income earned in a given year (absolute value).
 *
 * The engine fires its tax event on March 1 of year Y+1 for year Y income.
 * So to find the tax on 2035 income, we look at payments dated in 2036.
 */
function getEngineTaxTotal(incomeYear: number): number {
  // Tax payment for incomeYear appears in incomeYear+1 (March 1)
  const payments = getTaxPayments(incomeYear + 1);
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
 *   2044:      Alice RMD begins (Jan 1 age calculation)
 *   2050:      Full steady state (pension + SS + RMDs)
 */
describe('Tax — Progressive Brackets & Year-End Payments', () => {
  // Note: Pre-retirement tax not modeled — paycheck withholding feature (#36) not yet implemented
  // Years 2025-2028 are excluded from engine tax tests because taxes are assumed withheld from paychecks
  const POST_RETIREMENT_YEARS = [2029, 2035, 2037, 2040, 2044, 2050];
  // All years including pre-retirement (for shadow-only tests that don't compare to engine)
  const ALL_YEARS = [2025, 2026, 2027, 2028, ...POST_RETIREMENT_YEARS];

  describe('tax payment exists each year (post-retirement)', () => {
    for (const year of POST_RETIREMENT_YEARS) {
      it(`${year}: engine produces at least one tax payment`, () => {
        const payments = getTaxPayments(year);
        expect(payments.length).toBeGreaterThan(0);
      });
    }
  });

  describe('shadow calculator matches engine tax amount (post-retirement)', () => {
    for (const year of POST_RETIREMENT_YEARS) {
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

  describe('income comparison across retirement phases', () => {
    // Note: Pre-retirement tax not modeled — paycheck withholding feature (#36) not yet implemented
    // Compare post-retirement phases instead: pension-only vs pension+SS
    it('2040 (pension + both SS) tax should exceed 2029 (pension only) tax', () => {
      const tax2029 = getEngineTaxTotal(2029);
      const tax2040 = getEngineTaxTotal(2040);
      expect(tax2040).toBeGreaterThan(tax2029);
    });

    it('2035 (pension only, inflation-adjusted) tax should be positive', () => {
      const tax2035 = getEngineTaxTotal(2035);
      expect(tax2035).toBeGreaterThan(0);
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
    // Note: Cannot compare 2044 vs 2040 directly because 2040 includes large Roth
    // conversions and 401(k) auto-pulls that inflate its tax well above 2044.
    // Instead, compare two post-depletion years: 2047 (both Alice+Bob RMDs) has
    // larger RMDs than 2044 (first RMD year, Alice only), so 2047 tax > 2044 tax.
    it('2047 (larger RMDs) tax should exceed 2044 (first RMD year)', () => {
      const tax2044 = getEngineTaxTotal(2044);
      const tax2047 = getEngineTaxTotal(2047);
      expect(tax2047).toBeGreaterThan(tax2044);
    });

    it('2044: aggregate income should include RMD component', () => {
      // Alice's first RMD is 2044 (Jan 1 age calculation)
      const result = getDefaultResult();
      const startDate = '2044-01-01';
      const endDate = '2044-12-31';

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
    it('2029 pension-only income should have reasonable effective rate', () => {
      const { ordinaryIncome, ssIncome } = aggregateYearIncome(2029);
      const shadow = calculateAnnualFederalTax(
        ordinaryIncome,
        ssIncome,
        0,
        FILING_STATUS,
        2029,
        INFLATION,
        taxBrackets,
      );

      // Pension-only income should produce a low but positive effective rate
      expect(shadow.effectiveRate).toBeGreaterThan(0.0);
      expect(shadow.effectiveRate).toBeLessThan(0.20);
    });

    it('2040 (pension + both SS) should have higher effective rate than 2029 (pension only)', () => {
      const inc2029 = aggregateYearIncome(2029);
      const inc2040 = aggregateYearIncome(2040);

      const shadow2029 = calculateAnnualFederalTax(
        inc2029.ordinaryIncome,
        inc2029.ssIncome,
        0,
        FILING_STATUS,
        2029,
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

      expect(shadow2040.effectiveRate).toBeGreaterThan(shadow2029.effectiveRate);
    });
  });
});
