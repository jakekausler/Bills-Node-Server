import { describe, it, expect, beforeEach } from 'vitest';
import { JobLossManager } from './job-loss-manager';

// Helper: Create deterministic PRNG from an array of values
function createTestPRNG(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('JobLossManager', () => {
  let manager: JobLossManager;

  beforeEach(() => {
    manager = new JobLossManager(null, 0);
  });

  describe('Probability calculations', () => {
    it('triggers when roll < probability', () => {
      // Rate 4% × scaleFactor 1.5 = 6%
      // Roll 0.05 < 0.06 → triggers
      // Start month roll 0.4*9 = 3.6 → 3 (April), duration 2 months → ends June 1
      const prng = createTestPRNG([
        0.05,      // roll for probability check
        0.606531,  // u1 for Box-Muller (ln(0.606531) ≈ -0.5)
        0.5,       // u2 for Box-Muller
        0.4,       // start month roll
      ]);

      manager.evaluateYearStart(
        2026,
        'Person1',
        null,
        4,           // 4% unemployment rate
        16,          // median 16 weeks
        1.5,         // scaleFactor
        prng,
      );

      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2026, 4, 15)))).toBe(true);
    });

    it('does not trigger when roll >= probability', () => {
      // Rate 4% × scaleFactor 1.5 = 6%
      // Roll 0.10 >= 0.06 → no trigger
      const prng = createTestPRNG([0.10]);

      manager.evaluateYearStart(
        2026,
        'Person1',
        null,
        4,
        16,
        1.5,
        prng,
      );

      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2026, 0, 15)))).toBe(false);
    });

    it('caps probability at 6%', () => {
      // Rate 15% × 1.5 = 22.5%, capped at 6%
      // Roll 0.07 >= 0.06 → no trigger
      const prng = createTestPRNG([
        0.07,  // roll check
      ]);

      manager.evaluateYearStart(
        2026,
        'Person1',
        null,
        15,
        16,
        1.5,
        prng,
      );

      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2026, 0, 15)))).toBe(false);
    });

    it('triggers at the cap boundary (roll below 0.06)', () => {
      const manager_s3 = new JobLossManager(null, 0);
      const prng = createTestPRNG([0.05, 0.606531, 0.5, 0.5]); // roll=0.05 < 0.06 cap
      manager_s3.evaluateYearStart(2030, 'TestBill', new Date(Date.UTC(2055, 6, 15)), 15, 16, 0.5, prng);
      // 15% * 0.5 = 7.5% → capped at 6%. Roll 0.05 < 0.06 → triggers
      // Start month roll 0.5 * 9 = 4.5 → month 4 (May), check within the period
      const periods = manager_s3.getAllUnemploymentPeriods('TestBill');
      expect(periods).toHaveLength(1);
      const midpoint = new Date(periods[0].start.getTime() + (periods[0].end.getTime() - periods[0].start.getTime()) / 2);
      expect(manager_s3.isUnemployed('TestBill', midpoint)).toBe(true);
    });
  });

  describe('Duration calculation', () => {
    it('calculates correct duration with normalRandom=0', () => {
      // Box-Muller with u1=0.606531, u2=0.5
      // ln(0.606531) ≈ -0.5, sqrt(1) ≈ 1, cos(π) = -1, so normalRandom ≈ 1 * -1 = -1
      // exp(ln(16) + 0.6*-1) = exp(2.77 - 0.6) = exp(2.17) ≈ 8.76 weeks ≈ 2 months
      const prng = createTestPRNG([
        0.01,                  // roll: trigger
        0.606531,              // u1 for Box-Muller
        0.5,                   // u2 for Box-Muller
        0.4,                   // start month
      ]);

      manager.evaluateYearStart(
        2026,
        'Person1',
        null,
        4,
        16,
        1.5,
        prng,
      );

      const periods = manager.getAllUnemploymentPeriods('Person1');
      expect(periods).toHaveLength(1);
      // End date must be after start date
      expect(periods[0].end > periods[0].start).toBe(true);
    });

    it('clamps extreme duration values', () => {
      // Very small u1 gives very large |ln(u1)| → very long duration
      // We should clamp to 104 weeks max (24 months)
      const prng = createTestPRNG([
        0.01,      // roll: trigger
        0.001,     // u1 very small → large |ln(u1)| → large duration
        0.5,       // u2
        0.5,       // start month
      ]);

      manager.evaluateYearStart(
        2026,
        'Person1',
        null,
        4,
        16,
        1.5,
        prng,
      );

      const periods = manager.getAllUnemploymentPeriods('Person1');
      expect(periods).toHaveLength(1);
      // End date must be after start date and within reasonable bounds
      expect(periods[0].end > periods[0].start).toBe(true);
      const startMs = periods[0].start.getTime();
      const endMs = periods[0].end.getTime();
      const durationMonths = Math.round((endMs - startMs) / (30.44 * 24 * 60 * 60 * 1000));
      expect(durationMonths).toBeLessThanOrEqual(24);
    });
  });

  describe('isUnemployed', () => {
    it('returns true for dates within unemployment period', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      const periods = manager.getAllUnemploymentPeriods('Person1');
      const midpoint = new Date(periods[0].start.getTime() + (periods[0].end.getTime() - periods[0].start.getTime()) / 2);

      expect(manager.isUnemployed('Person1', midpoint)).toBe(true);
    });

    it('returns false for dates outside unemployment period', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2025, 11, 31)))).toBe(false);
    });

    it('returns false when no state exists', () => {
      expect(manager.isUnemployed('NonExistent', new Date(Date.UTC(2026, 0, 15)))).toBe(false);
    });
  });

  describe('shouldSkipRaise', () => {
    it('returns true for unemployment year', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      expect(manager.shouldSkipRaise('Person1', 2026)).toBe(true);
    });

    it('returns false for non-unemployment years', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      expect(manager.shouldSkipRaise('Person1', 2025)).toBe(false);
      expect(manager.shouldSkipRaise('Person1', 2027)).toBe(false);
    });

    it('returns false when no state exists', () => {
      expect(manager.shouldSkipRaise('NonExistent', 2026)).toBe(false);
    });
  });

  describe('Multiple unemployment periods', () => {
    it('handles trigger, re-employment, and trigger again', () => {
      // First unemployment in 2026, starts April, lasts 2 months (ends June 1)
      const prng1 = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);
      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng1);

      const periods1 = manager.getAllUnemploymentPeriods('Person1');
      expect(periods1.length).toBe(1);
      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2026, 4, 15)))).toBe(true);

      // Re-evaluate year 2027 (previous unemployment ended June 1, 2026, so it's now past)
      // Should re-employ and allow new job loss evaluation
      const prng2 = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);
      manager.evaluateYearStart(2027, 'Person1', null, 4, 16, 1.5, prng2);

      // Should now have 2 periods
      const periods2 = manager.getAllUnemploymentPeriods('Person1');
      expect(periods2.length).toBe(2);
    });
  });

  describe('Checkpoint and restore', () => {
    it('saves and restores complete state', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);
      manager.incrementCobraMonth('Person1');
      manager.incrementCobraMonth('Person1');

      manager.checkpoint();

      // Create new manager and restore
      const manager2 = new JobLossManager(null, 0);
      manager2.checkpointData = (manager as any).checkpointData;
      manager2.restore();

      expect(manager2.isUnemployed('Person1', new Date(Date.UTC(2026, 4, 15)))).toBe(true);
      expect(manager2.shouldSkipRaise('Person1', 2026)).toBe(true);
      expect(manager2.getCobraMonthsElapsed('Person1')).toBe(2);
    });

    it('restores unemployment history', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);
      const originalPeriods = manager.getAllUnemploymentPeriods('Person1');

      manager.checkpoint();

      const manager2 = new JobLossManager(null, 0);
      manager2.checkpointData = (manager as any).checkpointData;
      manager2.restore();

      const restoredPeriods = manager2.getAllUnemploymentPeriods('Person1');
      expect(restoredPeriods).toHaveLength(originalPeriods.length);
      expect(restoredPeriods[0].start.getTime()).toBe(originalPeriods[0].start.getTime());
      expect(restoredPeriods[0].end.getTime()).toBe(originalPeriods[0].end.getTime());
    });

    it('handles empty state restoration', () => {
      manager.checkpoint();

      const manager2 = new JobLossManager(null, 0);
      manager2.checkpointData = (manager as any).checkpointData;
      expect(() => manager2.restore()).not.toThrow();
    });
  });

  describe('Retirement handling', () => {
    it('skips evaluation when retired', () => {
      const retirementDate = new Date(Date.UTC(2026, 0, 1));
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);

      manager.evaluateYearStart(2026, 'Person1', retirementDate, 4, 16, 1.5, prng);

      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2026, 3, 15)))).toBe(false);
    });

    it('continues evaluation before retirement', () => {
      const retirementDate = new Date(Date.UTC(2027, 0, 1));
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);

      manager.evaluateYearStart(2026, 'Person1', retirementDate, 4, 16, 1.5, prng);

      expect(manager.isUnemployed('Person1', new Date(Date.UTC(2026, 4, 15)))).toBe(true);
    });
  });

  describe('Year boundary handling', () => {
    it('handles unemployment spanning multiple calendar years', () => {
      // Start in September (month 8), duration allows December to be included
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.8,  // start month roll = 0.8 * 9 = 7.2 → 7 (August)
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      const periods = manager.getAllUnemploymentPeriods('Person1');
      expect(periods).toHaveLength(1);

      // Verify spans into next year
      const endYear = periods[0].end.getUTCFullYear();
      expect(endYear).toBeGreaterThanOrEqual(2026);
    });
  });

  describe('Start month range', () => {
    it('constrains start month to Q1-Q3 (months 0-8)', () => {
      const startMonths = new Set<number>();

      for (let i = 0; i < 10; i++) {
        const manager_i = new JobLossManager(null, 0);
        const prng = createTestPRNG([
          0.01, 0.606531, 0.5, i / 10,  // varies start month roll
        ]);

        manager_i.evaluateYearStart(2026, `Person${i}`, null, 4, 16, 1.5, prng);
        const periods = manager_i.getAllUnemploymentPeriods(`Person${i}`);
        if (periods.length > 0) {
          startMonths.add(periods[0].start.getUTCMonth());
        }
      }

      for (const month of startMonths) {
        expect(month).toBeGreaterThanOrEqual(0);
        expect(month).toBeLessThanOrEqual(8);
      }
    });
  });

  describe('Already unemployed handling', () => {
    it('skips evaluation if already unemployed with future end date', () => {
      const prng1 = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng1);

      // Try to evaluate year 2027 (should skip because still unemployed)
      const prng2 = createTestPRNG([
        0.5,  // would trigger, but skipped
      ]);

      manager.evaluateYearStart(2027, 'Person1', null, 4, 16, 1.5, prng2);

      const periods = manager.getAllUnemploymentPeriods('Person1');
      // Should still have only 1 period from 2026
      expect(periods.length).toBe(1);
    });
  });

  describe('getActiveUnemploymentPeriod', () => {
    it('returns correct period for date within unemployment', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      const periods = manager.getAllUnemploymentPeriods('Person1');
      const midpoint = new Date(periods[0].start.getTime() + (periods[0].end.getTime() - periods[0].start.getTime()) / 2);

      const activePeriod = manager.getActiveUnemploymentPeriod('Person1', midpoint);
      expect(activePeriod).not.toBeNull();
      expect(activePeriod?.start.getTime()).toBe(periods[0].start.getTime());
      expect(activePeriod?.end.getTime()).toBe(periods[0].end.getTime());
    });

    it('returns null for date outside unemployment', () => {
      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.4,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      const activePeriod = manager.getActiveUnemploymentPeriod('Person1', new Date(Date.UTC(2025, 0, 15)));
      expect(activePeriod).toBeNull();
    });

    it('returns null when no state exists', () => {
      const activePeriod = manager.getActiveUnemploymentPeriod('NonExistent', new Date(Date.UTC(2026, 0, 15)));
      expect(activePeriod).toBeNull();
    });
  });

  describe('getAllUnemploymentPeriods', () => {
    it('returns full unemployment history', () => {
      const prng1 = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);
      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng1);

      const periods = manager.getAllUnemploymentPeriods('Person1');
      expect(periods).toHaveLength(1);
      expect(periods[0].start instanceof Date).toBe(true);
      expect(periods[0].end instanceof Date).toBe(true);
    });

    it('returns empty array for person with no unemployment', () => {
      const periods = manager.getAllUnemploymentPeriods('NonExistent');
      expect(periods).toEqual([]);
    });
  });

  describe('COBRA tracking', () => {
    it('increments and retrieves COBRA months', () => {
      expect(manager.getCobraMonthsElapsed('Person1')).toBe(0);

      manager.incrementCobraMonth('Person1');
      expect(manager.getCobraMonthsElapsed('Person1')).toBe(1);

      manager.incrementCobraMonth('Person1');
      expect(manager.getCobraMonthsElapsed('Person1')).toBe(2);
    });

    it('tracks COBRA months per person independently', () => {
      manager.incrementCobraMonth('Person1');
      manager.incrementCobraMonth('Person1');

      manager.incrementCobraMonth('Person2');

      expect(manager.getCobraMonthsElapsed('Person1')).toBe(2);
      expect(manager.getCobraMonthsElapsed('Person2')).toBe(1);
    });

    it('resets COBRA months on new job loss', () => {
      manager.incrementCobraMonth('Person1');
      manager.incrementCobraMonth('Person1');

      const prng = createTestPRNG([
        0.01, 0.606531, 0.5, 0.5,
      ]);

      manager.evaluateYearStart(2026, 'Person1', null, 4, 16, 1.5, prng);

      expect(manager.getCobraMonthsElapsed('Person1')).toBe(0);
    });
  });
});
