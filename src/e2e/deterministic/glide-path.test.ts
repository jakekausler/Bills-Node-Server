import { describe, it, expect } from 'vitest';
import { getActivitiesByName, getBalanceOnDate } from '../helpers';

describe('Portfolio Glide Path', () => {
  describe('allocation changes over time', () => {
    it('Brokerage earns returns based on blended allocation', () => {
      // 2025: 80% stocks (10%), 15% bonds (4%), 5% cash (2%)
      // TODO: Calculate blended return = 0.80*0.10 + 0.15*0.04 + 0.05*0.02
      const balance2025 = getBalanceOnDate('Brokerage', '2025-12-31');
      // TODO: Calculate expected balance after 1 year of blended returns minus expense ratio
      expect(balance2025).toBeCloseTo(0, -2); // PLACEHOLDER
    });

    it('interest activities exist across full simulation range', () => {
      const interest = getActivitiesByName('Brokerage', 'Interest');
      expect(interest.length).toBeGreaterThan(0);
      // Verify interest exists in later years (glide path shifts)
      const late = interest.filter(i => i.date.startsWith('2045'));
      expect(late.length).toBeGreaterThan(0);
    });
  });
});
