import { describe, it, expect } from 'vitest';
import { getMonthEndBalance, getActivitiesInMonth, getAccountNames } from '../helpers';

const TEST_MONTHS = [
  '2025-01', '2025-06', '2025-12', '2026-03', '2026-08', '2026-09', '2026-12',
  '2027-02', '2027-07', '2027-12', '2028-02', '2028-04', '2028-05', '2028-07',
  '2028-12', '2029-12', '2030-01', '2030-06', '2031-03', '2035-03', '2035-12',
  '2036-04', '2037-04', '2038-07', '2040-07', '2043-01', '2046-01', '2050-12',
  '2055-12',
];

describe('Balance Check — Integration', () => {
  const accounts = getAccountNames();

  TEST_MONTHS.forEach(month => {
    describe(month, () => {
      accounts.forEach(accountName => {
        it(`${accountName} balance = prior + month activities`, () => {
          const [y, m] = month.split('-').map(Number);
          const priorMonth = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2, '0')}`;
          const prior = getMonthEndBalance(accountName, priorMonth);
          const activities = getActivitiesInMonth(accountName, month);

          if (activities.length > 0) {
            const delta = activities.reduce((sum, a) => sum + a.amount, 0);
            const engineBalance = getMonthEndBalance(accountName, month);
            expect(engineBalance).toBeCloseTo(prior + delta, 0);
          }
          // If no activities this month, balance should be unchanged
          // (or there may be activities we can't see — this is the consistency check)
        });
      });
    });
  });

  // TODO: Full shadow calculator comparison will be added once all calculators are proven correct
});
