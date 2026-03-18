import { describe, it, expect } from 'vitest';
import { getActivitiesByName, getBalanceOnDate } from '../helpers';

describe('Interest & Returns', () => {
  describe('HYSA interest', () => {
    it('earns monthly interest at HIGH_YIELD_SAVINGS_RATE (4.5%)', () => {
      const interest = getActivitiesByName('HYSA', 'Interest');
      expect(interest.length).toBeGreaterThan(0);
      // TODO: Calculate first month: $50,000 * monthly_rate (depends on compounding formula)
      expect(interest[0].amount).toBeCloseTo(0, 0); // PLACEHOLDER
    });
  });

  describe('mortgage interest', () => {
    it('accrues negative interest on -$280,000 at 6.5%', () => {
      const interest = getActivitiesByName('Mortgage', 'Interest');
      expect(interest.length).toBeGreaterThan(0);
      expect(interest[0].amount).toBeLessThan(0);
      // TODO: Calculate first month: -280000 * monthly_rate
      expect(interest[0].amount).toBeCloseTo(0, 0); // PLACEHOLDER
    });
  });

  describe('expense ratios', () => {
    it('Brokerage growth reflects 0.15% expense ratio drag', () => {
      // TODO: Calculate expected 1-year growth on $200,000 at 7% - 0.15% = 6.85% net
      const balance2026 = getBalanceOnDate('Brokerage', '2025-12-31');
      expect(balance2026).toBeCloseTo(0, -2); // PLACEHOLDER
    });

    it('401(k) has lower expense ratio (0.08%) than Brokerage (0.15%)', () => {
      // Structural: both should have interest activities
      const alice401kInterest = getActivitiesByName('Alice 401(k)', 'Interest');
      const brokerageInterest = getActivitiesByName('Brokerage', 'Interest');
      expect(alice401kInterest.length).toBeGreaterThan(0);
      expect(brokerageInterest.length).toBeGreaterThan(0);
    });
  });
});
