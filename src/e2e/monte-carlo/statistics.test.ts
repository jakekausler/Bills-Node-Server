import { describe, it, expect } from 'vitest';
import { runSingleMCSim } from './mc-helpers';

describe('MC Statistics', () => {
  it('multiple simulations produce a range of outcomes', async () => {
    const finalBalances: number[] = [];
    for (let sim = 1; sim <= 3; sim++) {
      const result = await runSingleMCSim({
        seed: 12345, simulationNumber: sim, totalSimulations: 3,
        startDate: '2025-01-01', endDate: '2035-12-31',
      });
      const accounts = result.accounts.accounts || result.accounts;
      const checking = accounts.find((a: any) => a.name === 'Checking');
      if (checking?.consolidatedActivity?.length > 0) {
        finalBalances.push(checking.consolidatedActivity[checking.consolidatedActivity.length - 1].balance);
      }
    }
    expect(finalBalances.length).toBe(3);
    expect(Math.max(...finalBalances)).toBeGreaterThan(Math.min(...finalBalances));
  }, 300_000);

  it('each simulation gets a different derived seed', async () => {
    const run1 = await runSingleMCSim({
      seed: 12345, simulationNumber: 1, totalSimulations: 3,
      startDate: '2025-01-01', endDate: '2030-12-31',
    });
    const run2 = await runSingleMCSim({
      seed: 12345, simulationNumber: 2, totalSimulations: 3,
      startDate: '2025-01-01', endDate: '2030-12-31',
    });
    const a1 = (run1.accounts.accounts || run1.accounts).find((a: any) => a.name === 'Checking');
    const a2 = (run2.accounts.accounts || run2.accounts).find((a: any) => a.name === 'Checking');
    if (a1?.consolidatedActivity?.length && a2?.consolidatedActivity?.length) {
      expect(a1.consolidatedActivity[a1.consolidatedActivity.length - 1].balance)
        .not.toBe(a2.consolidatedActivity[a2.consolidatedActivity.length - 1].balance);
    }
  }, 120_000);
});
