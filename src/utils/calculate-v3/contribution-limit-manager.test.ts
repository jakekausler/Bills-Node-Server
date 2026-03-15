import { describe, it, expect, beforeEach } from 'vitest';
import { ContributionLimitManager } from './contribution-limit-manager';

describe('ContributionLimitManager', () => {
  let manager: ContributionLimitManager;

  beforeEach(() => {
    manager = new ContributionLimitManager();
  });

  describe('getRemainingLimit', () => {
    it('should return full limit for first contribution in a year', () => {
      const dob = new Date('1980-06-15');
      const remaining = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining).toBe(23500);
    });

    it('should return Infinity if no DOB provided', () => {
      const remaining = manager.getRemainingLimit(null, 2024, '401k');
      expect(remaining).toBe(Infinity);
    });

    it('should apply catch-up for age 50+ in 401k', () => {
      const dob = new Date('1974-06-15'); // Age 50 in 2024
      const remaining = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining).toBe(23500 + 7500); // Base + catch-up
    });

    it('should apply catch-up for age 50+ in IRA', () => {
      const dob = new Date('1974-06-15'); // Age 50 in 2024
      const remaining = manager.getRemainingLimit(dob, 2024, 'ira');
      expect(remaining).toBe(7000 + 1000); // Base + catch-up
    });

    it('should apply catch-up for age 55+ in HSA', () => {
      const dob = new Date('1969-06-15'); // Age 55 in 2024
      const remaining = manager.getRemainingLimit(dob, 2024, 'hsa');
      expect(remaining).toBe(4150 + 1000); // Base + catch-up
    });

    it('should NOT apply HSA catch-up for age 50-54', () => {
      const dob = new Date('1974-06-15'); // Age 50 in 2024
      const remaining = manager.getRemainingLimit(dob, 2024, 'hsa');
      expect(remaining).toBe(4150); // Base only, no catch-up at age 50
    });

    it('should respect recorded contributions', () => {
      const dob = new Date('1980-06-15'); // Age 44 in 2024
      manager.recordContribution(dob, 2024, '401k', 5000);
      const remaining = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining).toBe(23500 - 5000);
    });

    it('should return 0 when limit is exceeded', () => {
      const dob = new Date('1980-06-15');
      manager.recordContribution(dob, 2024, '401k', 25000);
      const remaining = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining).toBe(0);
    });

    it('should accumulate multiple contributions in same year', () => {
      const dob = new Date('1980-06-15');
      manager.recordContribution(dob, 2024, '401k', 3000);
      manager.recordContribution(dob, 2024, '401k', 2000);
      const remaining = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining).toBe(23500 - 5000);
    });

    it('should separate limits by person (DOB)', () => {
      const dob1 = new Date('1980-06-15');
      const dob2 = new Date('1985-01-20');

      manager.recordContribution(dob1, 2024, '401k', 10000);
      const remaining1 = manager.getRemainingLimit(dob1, 2024, '401k');
      expect(remaining1).toBe(23500 - 10000);

      const remaining2 = manager.getRemainingLimit(dob2, 2024, '401k');
      expect(remaining2).toBe(23500); // Unaffected
    });

    it('should separate limits by year', () => {
      const dob = new Date('1980-06-15');
      manager.recordContribution(dob, 2024, '401k', 5000);

      // 2025 should have full limit
      const remaining2025 = manager.getRemainingLimit(dob, 2025, '401k');
      expect(remaining2025).toBeGreaterThan(23500); // Inflated

      // 2024 should still show reduced limit
      const remaining2024 = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining2024).toBe(23500 - 5000);
    });

    it('should separate limits by contribution type', () => {
      const dob = new Date('1980-06-15');
      manager.recordContribution(dob, 2024, '401k', 5000);

      // IRA limit should be unaffected
      const remaining = manager.getRemainingLimit(dob, 2024, 'ira');
      expect(remaining).toBe(7000);
    });
  });

  describe('recordContribution', () => {
    it('should accept positive contributions', () => {
      const dob = new Date('1980-06-15');
      expect(() => {
        manager.recordContribution(dob, 2024, '401k', 5000);
      }).not.toThrow();
    });

    it('should ignore contributions with no DOB', () => {
      expect(() => {
        manager.recordContribution(null, 2024, '401k', 5000);
      }).not.toThrow();
    });

    it('should ignore zero or negative contributions', () => {
      const dob = new Date('1980-06-15');
      manager.recordContribution(dob, 2024, '401k', 0);
      manager.recordContribution(dob, 2024, '401k', -1000);

      const remaining = manager.getRemainingLimit(dob, 2024, '401k');
      expect(remaining).toBe(23500); // Unchanged
    });
  });

  describe('inflation', () => {
    it('should inflate limits year-over-year', () => {
      const dob = new Date('1980-06-15');
      const limit2024 = manager.getRemainingLimit(dob, 2024, '401k');
      const limit2025 = manager.getRemainingLimit(dob, 2025, '401k');

      // 2.5% inflation
      const expected2025 = Math.round(limit2024 * 1.025);
      expect(limit2025).toBe(expected2025);
    });

    it('should compound inflation over multiple years', () => {
      const dob = new Date('1980-06-15');
      const limit2024 = manager.getRemainingLimit(dob, 2024, '401k');
      const limit2026 = manager.getRemainingLimit(dob, 2026, '401k');

      // 2.5% inflation for 2 years
      const expected2026 = Math.round(limit2024 * Math.pow(1.025, 2));
      expect(limit2026).toBe(expected2026);
    });
  });

  describe('age calculations', () => {
    it('should calculate age correctly at year boundary', () => {
      // Born June 15, 1974
      const dob = new Date('1974-06-15');

      // At end of 2024, age is 50
      const limit2024 = manager.getRemainingLimit(dob, 2024, '401k');
      expect(limit2024).toBe(23500 + 7500); // Has catch-up

      // At end of 2023, age is 49
      const limit2023 = manager.getRemainingLimit(dob, 2023, '401k');
      expect(limit2023).toBe(23500); // No catch-up yet
    });

    it('should handle birthday on Dec 31', () => {
      // Born Dec 31, 1974 - will turn 50 on last day of 2024
      const dob = new Date('1974-12-31');
      const limit2024 = manager.getRemainingLimit(dob, 2024, '401k');
      // By end of 2024, age is 50
      expect(limit2024).toBe(23500 + 7500);
    });

    it('should handle birthday on Jan 1', () => {
      // Born Jan 1, 1974 - turned 50 on first day of 2024
      const dob = new Date('1974-01-01');
      const limit2024 = manager.getRemainingLimit(dob, 2024, '401k');
      expect(limit2024).toBe(23500 + 7500);
    });
  });

  describe('HSA specific', () => {
    it('should use individual limit for HSA', () => {
      const dob = new Date('1980-06-15'); // Age 44
      const remaining = manager.getRemainingLimit(dob, 2024, 'hsa');
      expect(remaining).toBe(4150);
    });

    it('should apply catch-up at age 55 for HSA', () => {
      const dob = new Date('1969-06-15'); // Age 55 in 2024
      const remaining = manager.getRemainingLimit(dob, 2024, 'hsa');
      expect(remaining).toBe(4150 + 1000);
    });
  });

  describe('integration scenarios', () => {
    it('should handle Jake and Kendall separately (issue #12 scenario)', () => {
      const jakeDOB = new Date('1980-06-15');
      const kendallDOB = new Date('1982-03-20');

      // Both contribute to 401k in 2024
      manager.recordContribution(jakeDOB, 2024, '401k', 5000);
      manager.recordContribution(kendallDOB, 2024, '401k', 7500);

      // Check remaining limits
      const jakeRemaining = manager.getRemainingLimit(jakeDOB, 2024, '401k');
      const kendallRemaining = manager.getRemainingLimit(kendallDOB, 2024, '401k');

      expect(jakeRemaining).toBe(23500 - 5000);
      expect(kendallRemaining).toBe(23500 - 7500);
    });

    it('should handle multiple account types per person', () => {
      const dob = new Date('1980-06-15');

      // Contribute to both 401k and IRA
      manager.recordContribution(dob, 2024, '401k', 5000);
      manager.recordContribution(dob, 2024, 'ira', 2000);

      const remaining401k = manager.getRemainingLimit(dob, 2024, '401k');
      const remainingIRA = manager.getRemainingLimit(dob, 2024, 'ira');

      expect(remaining401k).toBe(23500 - 5000);
      expect(remainingIRA).toBe(7000 - 2000);
    });

    it('should handle year rollover correctly', () => {
      const dob = new Date('1980-06-15');

      // Max out 401k in 2024
      manager.recordContribution(dob, 2024, '401k', 23500);

      // 2025 should have full inflated limit
      const remaining2024 = manager.getRemainingLimit(dob, 2024, '401k');
      const remaining2025 = manager.getRemainingLimit(dob, 2025, '401k');

      expect(remaining2024).toBe(0);
      expect(remaining2025).toBeGreaterThan(23500);
    });
  });

  describe('MC change ratios', () => {
    it('should use historical limits for historical years', () => {
      const dob = new Date('1980-06-15');
      // 2024 should use historical limit (23500)
      const limit2024 = manager.getRemainingLimit(dob, 2024, '401k');
      expect(limit2024).toBe(23500);
    });

    it('should use MC ratio to compound from previous year', () => {
      const dob = new Date('1980-06-15');
      // Simulate MC ratio: 1.146341 (from 2024 historical data)
      const mcRatio = 1.146341;
      const limit2026 = manager.getRemainingLimit(dob, 2026, '401k', mcRatio);

      // Should start from previous year and compound
      // This requires the recursion to work properly
      expect(limit2026).toBeGreaterThan(0);
    });

    it('should use fixed inflation without MC ratio', () => {
      const dob = new Date('1980-06-15');
      // Without MC ratio, should use fixed 2.5% inflation
      const limit2025 = manager.getRemainingLimit(dob, 2025, '401k');
      expect(limit2025).toBe(Math.round(23500 * 1.025));
    });

    it('should handle MC ratio for future years', () => {
      const dob = new Date('1980-06-15');
      const ratio1 = 1.05; // 5% increase
      const ratio2 = 1.03; // 3% increase

      const limit2026 = manager.getAnnualLimit(dob, 2026, '401k', ratio1);
      const limit2027 = manager.getAnnualLimit(dob, 2027, '401k', ratio2);

      expect(limit2026).toBeGreaterThan(0);
      expect(limit2027).toBeGreaterThan(0);
    });
  });
});
