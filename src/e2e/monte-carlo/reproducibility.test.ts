import { describe, it, expect } from 'vitest';
import { runSingleMCSim } from './mc-helpers';

describe('MC Reproducibility', () => {
  it('same seed produces identical results', async () => {
    const run1 = await runSingleMCSim({
      seed: 12345, simulationNumber: 1, totalSimulations: 1,
      startDate: '2025-01-01', endDate: '2030-12-31',
    });
    const run2 = await runSingleMCSim({
      seed: 12345, simulationNumber: 1, totalSimulations: 1,
      startDate: '2025-01-01', endDate: '2030-12-31',
    });

    // Compare final balances of each account
    const accts1 = run1.accounts.accounts || run1.accounts;
    const accts2 = run2.accounts.accounts || run2.accounts;
    for (let i = 0; i < accts1.length; i++) {
      if (accts1[i].consolidatedActivity?.length > 0) {
        const bal1 = accts1[i].consolidatedActivity[accts1[i].consolidatedActivity.length - 1].balance;
        const bal2 = accts2[i].consolidatedActivity[accts2[i].consolidatedActivity.length - 1].balance;
        expect(bal1).toBe(bal2);
      }
    }
  }, 120_000);

  it('different seeds produce different results', async () => {
    const run1 = await runSingleMCSim({
      seed: 12345, simulationNumber: 1, totalSimulations: 1,
      startDate: '2025-01-01', endDate: '2030-12-31',
    });
    const run2 = await runSingleMCSim({
      seed: 99999, simulationNumber: 1, totalSimulations: 1,
      startDate: '2025-01-01', endDate: '2030-12-31',
    });

    const accts1 = run1.accounts.accounts || run1.accounts;
    const accts2 = run2.accounts.accounts || run2.accounts;
    const diffs = accts1.filter((a1: any, i: number) => {
      const a2 = accts2[i];
      if (a1.consolidatedActivity?.length > 0 && a2.consolidatedActivity?.length > 0) {
        return a1.consolidatedActivity[a1.consolidatedActivity.length - 1].balance !==
               a2.consolidatedActivity[a2.consolidatedActivity.length - 1].balance;
      }
      return false;
    });
    expect(diffs.length).toBeGreaterThan(0);
  }, 120_000);
});
