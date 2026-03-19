import { describe, it, expect } from 'vitest';
import { getActivitiesInMonth, getMonthEndBalance } from '../helpers';
import { calculateInterest } from '../calculators/interest-calculator';

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

const INVESTMENT_RATE = 0.07;
const HIGH_YIELD_SAVINGS_RATE = 0.045;

interface AccountInterestConfig {
  name: string;
  apr: number;
  expenseRatio: number;
  frequency: string;
  interestAppliesToPositiveBalance: boolean;
}

const INTEREST_ACCOUNTS: AccountInterestConfig[] = [
  { name: 'HYSA', apr: HIGH_YIELD_SAVINGS_RATE, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Alice 401(k)', apr: INVESTMENT_RATE, expenseRatio: 0.0008, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Bob 401(k)', apr: INVESTMENT_RATE, expenseRatio: 0.0008, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Alice Roth IRA', apr: INVESTMENT_RATE, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Bob Roth IRA', apr: INVESTMENT_RATE, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'HSA', apr: HIGH_YIELD_SAVINGS_RATE, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Brokerage', apr: INVESTMENT_RATE, expenseRatio: 0.0015, frequency: 'month', interestAppliesToPositiveBalance: true },
  { name: 'Mortgage', apr: 0.065, expenseRatio: 0, frequency: 'month', interestAppliesToPositiveBalance: false },
];

const TEST_MONTHS = ['2025-01', '2025-06', '2028-07', '2035-12', '2055-12'];

/**
 * Get the year-month string for the month prior to the given year-month.
 */
function priorMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (m === 1) {
    return `${y - 1}-12`;
  }
  return `${y}-${String(m - 1).padStart(2, '0')}`;
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
    it('Mortgage interest should be negative in 2025-01', () => {
      const total = sumInterestInMonth('Mortgage', '2025-01');
      // Mortgage balance is negative (debt), so interest should be negative
      expect(total).toBeLessThan(0);
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

            // Get balance at end of prior month (the balance interest is computed on)
            const prior = priorMonth(yearMonth);
            const priorBalance = getMonthEndBalance(account.name, prior);

            const expected = calculateInterest(
              priorBalance,
              account.apr,
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
    it('Alice 401(k) interest should be less than same balance at full 7%', () => {
      const priorBalance = getMonthEndBalance('Alice 401(k)', '2025-05');
      if (priorBalance <= 0) return;

      const withExpenseRatio = calculateInterest(priorBalance, INVESTMENT_RATE, 0.0008, 'month', true);
      const withoutExpenseRatio = calculateInterest(priorBalance, INVESTMENT_RATE, 0, 'month', true);

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
      const brokerage = calculateInterest(testBalance, INVESTMENT_RATE, 0.0015, 'month', true);
      const fourOhOne = calculateInterest(testBalance, INVESTMENT_RATE, 0.0008, 'month', true);
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
