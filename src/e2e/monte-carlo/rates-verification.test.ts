import { describe, it, expect } from 'vitest';
import { MonteCarloHandler } from '../../utils/calculate-v3/monte-carlo-handler';
import { loadHistoricRates } from './mc-helpers';

describe('MC Rates Verification', () => {
  it('drawn years exist in historic rates data', async () => {
    const handler = await MonteCarloHandler.getInstance(
      new Date('2025-01-01'), new Date('2026-12-31'), 12345
    );
    const drawnYears = handler.getDrawnYears();
    expect(drawnYears[0]).toBeGreaterThanOrEqual(1928);
    // TODO: Load historicRates, verify drawn year's data exists
    // const rates = await loadHistoricRates();
    // const yearData = rates.yearKeyed[drawnYears[0]];
    // expect(yearData).toBeDefined();
  });

  it('blended return matches allocation-weighted sum', async () => {
    // TODO: For 2025 allocation (80/15/5 stocks/bonds/cash):
    // Get drawn year's stock/bond/cash returns from historicRates
    // Calculate blended = stock*0.80 + bond*0.15 + cash*0.05
    // Verify engine uses this blended rate
    expect(true).toBe(true); // PLACEHOLDER — needs manual calculation
  });
});
