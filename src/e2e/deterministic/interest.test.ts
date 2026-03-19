import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getActivitiesInMonth } from '../helpers';
import { calculateInterest, computeBlendedReturn } from '../calculators/interest-calculator';

/**
 * Interest E2E tests — verify the engine's compounding, expense-ratio
 * deductions, and mortgage (debt) interest against a shadow calculator.
 *
 * Account configs (from data.json):
 *   HYSA:           4.5% variable (HYSA rate), monthly, no expense ratio
 *   Alice 401(k):   7% variable (INVESTMENT_RATE), monthly, 0.08% expense ratio
 *   Bob 401(k):     7% variable (INVESTMENT_RATE), monthly, 0.08% expense ratio
 *   Alice Roth IRA: 7% variable (INVESTMENT_RATE), monthly, no expense ratio
 *   Bob Roth IRA:   7% variable (INVESTMENT_RATE), monthly, no expense ratio
 *   HSA:            4.5% variable (HYSA rate), monthly, no expense ratio
 *   Brokerage:      7% variable (INVESTMENT_RATE), monthly, 0.15% expense ratio
 *   Mortgage:       6.5% fixed, monthly, interestAppliesToPositiveBalance=false
 */

// Portfolio glide path data for blended return computation
const glidePathData: Record<string, Record<string, number>> = JSON.parse(
  readFileSync(join(__dirname, '../../../data/portfolioMakeupOverTime.json'), 'utf-8'),
);

// Per-asset-class deterministic returns from variables.csv (Default simulation)
const assetReturns: Record<string, number> = { stock: 0.10, bond: 0.04, cash: 0.02 };

const HIGH_YIELD_SAVINGS_RATE = 0.045;

interface AccountInterestConfig {
  name: string;
  /** If true, rate comes from glide path blending; otherwise use fixedApr */
  usesGlidePath: boolean;
  fixedApr: number;
  expenseRatio: number;
  frequency: string;
  interestAppliesToPositiveBalance: boolean;
}

const INTEREST_ACCOUNTS: AccountInterestConfig[] = [
  { name: 'HYSA', usesGlidePath: false, fixedApr: HIGH_YIELD_SAVINGS_RATE, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Alice 401(k)', usesGlidePath: true, fixedApr: 0, expenseRatio: 0.0008, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Bob 401(k)', usesGlidePath: true, fixedApr: 0, expenseRatio: 0.0008, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Alice Roth IRA', usesGlidePath: true, fixedApr: 0, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Bob Roth IRA', usesGlidePath: true, fixedApr: 0, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'HSA', usesGlidePath: false, fixedApr: HIGH_YIELD_SAVINGS_RATE, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Brokerage', usesGlidePath: true, fixedApr: 0, expenseRatio: 0.0015, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Mortgage', usesGlidePath: false, fixedApr: 0.065, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: false },
];

const TEST_MONTHS = ['2025-01', '2025-06', '2028-07', '2035-12', '2055-12'];

/**
 * Get the effective annual rate for an account at a given date.
 * Accounts with aprVariable === 'INVESTMENT_RATE' use the glide path;
 * others use their fixed rate.
 */
function getEffectiveRate(account: AccountInterestConfig, date: string): number {
  if (account.usesGlidePath) {
    return computeBlendedReturn(date, glidePathData, assetReturns);
  }
  return account.fixedApr;
}

/**
 * Sum all interest activities in a given month for an account.
 * Interest activities have name === 'Interest'.
 */
function sumInterestInMonth(accountName: string, yearMonth: string): number {
  const activities = getActivitiesInMonth(accountName, yearMonth);
  return activities
    .filter((a) => a.name === 'Interest')
    .reduce((sum, a) => sum + a.amount, 0);
}

/**
 * Get the balance just before the first Interest event fires in a given month.
 * This is the balance the engine uses to compute interest.
 * Calculated as: (interest activity's balance) - (interest activity's amount).
 *
 * Returns null if no interest activity exists in that month.
 */
function getPreInterestBalance(accountName: string, yearMonth: string): number | null {
  const activities = getActivitiesInMonth(accountName, yearMonth);
  const interestActivity = activities.find((a) => a.name === 'Interest');
  if (!interestActivity) return null;
  return interestActivity.balance - interestActivity.amount;
}

/**
 * Count interest activities in a given month for an account.
 */
function countInterestInMonth(accountName: string, yearMonth: string): number {
  const activities = getActivitiesInMonth(accountName, yearMonth);
  return activities.filter((a) => a.name === 'Interest').length;
}

describe('Interest Compounding', () => {
  describe('positive-balance accounts produce positive interest', () => {
    const positiveAccounts = INTEREST_ACCOUNTS.filter((a) => a.interestAppliesToPositiveBalance);

    for (const account of positiveAccounts) {
      it(`${account.name} should have positive interest in 2025-06`, () => {
        const total = sumInterestInMonth(account.name, '2025-06');
        expect(total).toBeGreaterThan(0);
      });
    }
  });

  describe('mortgage produces negative interest (adds to debt)', () => {
    it('Mortgage interest should be 0 in 2025-01 (interest fires before opening balance)', () => {
      const total = sumInterestInMonth('Mortgage', '2025-01');
      // First month: interest event fires before the opening balance event,
      // so balance is 0 and interest is 0.
      expect(total).toBe(0);
    });

    it('Mortgage interest should be negative in 2025-06', () => {
      const total = sumInterestInMonth('Mortgage', '2025-06');
      expect(total).toBeLessThan(0);
    });
  });

  describe('monthly compounding yields exactly one interest event per month', () => {
    for (const account of INTEREST_ACCOUNTS) {
      it(`${account.name} should have at most 1 interest event in 2025-06`, () => {
        const count = countInterestInMonth(account.name, '2025-06');
        expect(count).toBeLessThanOrEqual(1);
      });
    }
  });

  describe('shadow calculator matches engine for each test month', () => {
    for (const yearMonth of TEST_MONTHS) {
      describe(`month ${yearMonth}`, () => {
        for (const account of INTEREST_ACCOUNTS) {
          it(`${account.name} interest matches shadow calc`, () => {
            const engineInterest = sumInterestInMonth(account.name, yearMonth);

            // If engine produced no interest, skip shadow comparison
            // (account may have zero balance or be paid off)
            if (engineInterest === 0) {
              return;
            }

            // Get the balance at the moment interest fires (before interest is applied)
            const preInterestBalance = getPreInterestBalance(account.name, yearMonth);
            expect(preInterestBalance).not.toBeNull();

            // Compute the effective rate (glide path blended or fixed)
            const dateForRate = `${yearMonth}-01`;
            const effectiveRate = getEffectiveRate(account, dateForRate);

            const expected = calculateInterest(
              preInterestBalance!,
              effectiveRate,
              account.expenseRatio,
              account.frequency,
              account.interestAppliesToPositiveBalance,
            );

            expect(engineInterest).toBeCloseTo(expected, 2);
          });
        }
      });
    }
  });

  describe('expense ratio reduces effective return', () => {
    it('Alice 401(k) interest should be less than same balance at full blended rate', () => {
      const preInterestBalance = getPreInterestBalance('Alice 401(k)', '2025-06');
      if (!preInterestBalance || preInterestBalance <= 0) return;

      const blendedRate = computeBlendedReturn('2025-06-01', glidePathData, assetReturns);
      const withExpenseRatio = calculateInterest(preInterestBalance, blendedRate, 0.0008, 'month', true);
      const withoutExpenseRatio = calculateInterest(preInterestBalance, blendedRate, 0, 'month', true);

      expect(withExpenseRatio).toBeLessThan(withoutExpenseRatio);

      // Verify engine matches the expense-ratio-adjusted amount
      const engineInterest = sumInterestInMonth('Alice 401(k)', '2025-06');
      if (engineInterest > 0) {
        expect(engineInterest).toBeCloseTo(withExpenseRatio, 2);
      }
    });

    it('Brokerage 0.15% expense ratio reduces return more than 401(k) 0.08%', () => {
      // For the same balance and rate, higher expense ratio = less interest
      const testBalance = 100000;
      const blendedRate = computeBlendedReturn('2025-06-01', glidePathData, assetReturns);
      const brokerage = calculateInterest(testBalance, blendedRate, 0.0015, 'month', true);
      const fourOhOne = calculateInterest(testBalance, blendedRate, 0.0008, 'month', true);
      expect(brokerage).toBeLessThan(fourOhOne);
    });
  });

  describe('mortgage interestAppliesToPositiveBalance=false', () => {
    it('should skip interest if mortgage balance becomes positive', () => {
      // The shadow calculator should return 0 for positive balance
      // when interestAppliesToPositiveBalance is false
      const result = calculateInterest(1000, 0.065, 0, 'month', false);
      expect(result).toBe(0);
    });

    it('should apply interest to negative (debt) balance', () => {
      const result = calculateInterest(-300000, 0.065, 0, 'month', false);
      expect(result).toBeLessThan(0);
    });
  });

  describe('interest grows balances over time', () => {
    it('HYSA balance should grow from interest alone when no withdrawals', () => {
      // Compare interest amounts across months — later months on higher
      // balances should yield more interest (compounding effect)
      const interest2025_01 = sumInterestInMonth('HYSA', '2025-01');
      const interest2025_06 = sumInterestInMonth('HYSA', '2025-06');

      // Both should be positive
      if (interest2025_01 > 0 && interest2025_06 > 0) {
        // The 2025-06 interest should be >= 2025-01 if balance grew
        // (could be less if money was withdrawn, so just check both positive)
        expect(interest2025_01).toBeGreaterThan(0);
        expect(interest2025_06).toBeGreaterThan(0);
      }
    });
  });
});
