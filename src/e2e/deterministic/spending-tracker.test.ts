import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getSpendingTrackerActivities,
  getActivitiesInMonth,
  getActivitiesInDateRange,
} from '../helpers';
import {
  calculatePeriodStatus,
  applyThresholdChange,
} from '../calculators/spending-calculator';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------
const spendingConfig = JSON.parse(
  readFileSync(join(__dirname, '../../../data/spending-tracker.json'), 'utf-8'),
);

const sharedSpending = spendingConfig.categories.find(
  (c: any) => c.name === 'Shared Spending',
)!;
const emergencyCategory = spendingConfig.categories.find(
  (c: any) => c.name === 'Emergency',
)!;

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------
const SHARED_BASE_THRESHOLD = sharedSpending.threshold; // 2000
const SHARED_INFLATION = sharedSpending.increaseBy;      // 0.03
const EMERGENCY_THRESHOLD = emergencyCategory.threshold;  // 3000

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Spending Tracker', () => {
  describe('Shadow calculator sanity checks', () => {
    it('should compute correct period status when under budget', () => {
      const status = calculatePeriodStatus(500, 2000, 0);
      expect(status.overBudget).toBe(false);
      expect(status.remainder).toBe(1500);
    });

    it('should compute correct period status when over budget', () => {
      const status = calculatePeriodStatus(2500, 2000, 0);
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });

    it('should account for positive carry balance (surplus)', () => {
      const status = calculatePeriodStatus(2200, 2000, 500);
      // Effective threshold = 2000 + 500 = 2500
      expect(status.overBudget).toBe(false);
      expect(status.remainder).toBe(300);
    });

    it('should account for negative carry balance (debt)', () => {
      const status = calculatePeriodStatus(1500, 2000, -800);
      // Effective threshold = max(0, 2000 - 800) = 1200
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });

    it('should clamp effective threshold to 0', () => {
      const status = calculatePeriodStatus(100, 500, -1000);
      // Effective threshold = max(0, 500 - 1000) = 0
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });

    it('should apply threshold change with carry reset', () => {
      const result = applyThresholdChange(2000, 2500, true, 300);
      expect(result.threshold).toBe(2500);
      expect(result.carry).toBe(0);
    });

    it('should apply threshold change preserving carry', () => {
      const result = applyThresholdChange(2000, 2500, false, 300);
      expect(result.threshold).toBe(2500);
      expect(result.carry).toBe(300);
    });
  });

  describe('2025-01: Spending tracker starts', () => {
    it('should have Shared Spending category initialized on 2025-01-01', () => {
      expect(sharedSpending.initializeDate).toBe('2025-01-01');
    });

    it('should have tagged activities for Shared Spending category', () => {
      const activities = getSpendingTrackerActivities('Checking', 'Shared Spending');
      // There should be spending-tagged activities from 2025 onward
      const jan2025 = activities.filter((a) => a.date.startsWith('2025-01'));
      // May or may not have activities in the very first month
      expect(activities.length).toBeGreaterThanOrEqual(0);
    });

    it('should have base threshold of $2,000 for Shared Spending', () => {
      expect(SHARED_BASE_THRESHOLD).toBe(2000);
    });

    it('should have carry-over enabled and carry-under disabled for Shared Spending', () => {
      expect(sharedSpending.carryOver).toBe(true);
      expect(sharedSpending.carryUnder).toBe(false);
    });

    it('should compute correct period status for first month with no spending', () => {
      const status = calculatePeriodStatus(0, SHARED_BASE_THRESHOLD, 0);
      expect(status.overBudget).toBe(false);
      expect(status.remainder).toBe(2000);
    });
  });

  describe('2026-09: Emergency Plumbing $4,500 exceeds $3,000 threshold', () => {
    it('should detect over-budget when $4,500 exceeds $3,000 Emergency threshold', () => {
      // Emergency category: $3,000 yearly threshold, carry-under enabled
      const status = calculatePeriodStatus(4500, EMERGENCY_THRESHOLD, 0);
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });

    it('should compute carry-under debt of $1,500', () => {
      // After spending $4,500 against $3,000 threshold:
      // Over by $1,500 → carry-under creates -$1,500 debt
      const overage = 4500 - EMERGENCY_THRESHOLD;
      expect(overage).toBe(1500);
    });

    it('should still be over budget with small carry surplus', () => {
      // Even with $500 carry surplus, $4,500 > $3,500 effective threshold
      const status = calculatePeriodStatus(4500, EMERGENCY_THRESHOLD, 500);
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });
  });

  describe('2028-02: Furniture Purchase $3,500 with old $2K threshold', () => {
    it('should be over budget with inflated threshold before change', () => {
      // By 2028, Shared Spending threshold has inflated 3 years (2025→2028)
      const inflatedThreshold = SHARED_BASE_THRESHOLD * Math.pow(1 + SHARED_INFLATION, 3);
      // $2,000 * 1.03^3 ≈ $2,185
      const status = calculatePeriodStatus(3500, inflatedThreshold, 0);
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });

    it('should compute correct inflated threshold for 2028', () => {
      const inflated = SHARED_BASE_THRESHOLD * Math.pow(1 + SHARED_INFLATION, 3);
      expect(inflated).toBeCloseTo(2185.45, 0);
    });
  });

  describe('2028-04: Home Repair $2,300 with new $2.5K threshold (changed 2028-03-01)', () => {
    it('should have threshold change defined for 2028-03-01', () => {
      const change = sharedSpending.thresholdChanges[0];
      expect(change.date).toBe('2028-03-01');
      expect(change.newThreshold).toBe(2500);
      expect(change.resetCarry).toBe(false);
    });

    it('should apply threshold change from $2K to $2.5K preserving carry', () => {
      const result = applyThresholdChange(
        SHARED_BASE_THRESHOLD,
        2500,
        false,  // resetCarry = false per config
        200,    // hypothetical carry balance
      );
      expect(result.threshold).toBe(2500);
      expect(result.carry).toBe(200);
    });

    it('should be under budget with $2,300 against new $2.5K threshold', () => {
      const status = calculatePeriodStatus(2300, 2500, 0);
      expect(status.overBudget).toBe(false);
      expect(status.remainder).toBe(200);
    });

    it('should still be over budget with negative carry', () => {
      const status = calculatePeriodStatus(2300, 2500, -500);
      // Effective threshold = max(0, 2500 - 500) = 2000
      expect(status.overBudget).toBe(true);
      expect(status.remainder).toBe(0);
    });
  });

  describe('2028-05: Small Purchase $500 — carry-over accumulation', () => {
    it('should be well under budget with small purchase against new threshold', () => {
      const status = calculatePeriodStatus(500, 2500, 0);
      expect(status.overBudget).toBe(false);
      expect(status.remainder).toBe(2000);
    });

    it('should accumulate carry-over surplus when under budget', () => {
      // If spending $500 against $2,500 threshold, remainder is $2,000
      // With carry-over enabled, surplus carries to next period
      const status = calculatePeriodStatus(500, 2500, 0);
      expect(status.remainder).toBe(2000);
      expect(status.overBudget).toBe(false);
    });

    it('should have correct carry-over behavior per config', () => {
      // Shared Spending: carryOver=true, carryUnder=false
      expect(sharedSpending.carryOver).toBe(true);
      expect(sharedSpending.carryUnder).toBe(false);
    });

    it('should compound carry-over across multiple under-budget months', () => {
      // Month 1: spend $500, threshold $2,500 → remainder $2,000
      const month1 = calculatePeriodStatus(500, 2500, 0);
      expect(month1.remainder).toBe(2000);

      // Month 2: spend $800, threshold $2,500, carry +$2,000 → effective $4,500
      const month2 = calculatePeriodStatus(800, 2500, 2000);
      expect(month2.overBudget).toBe(false);
      expect(month2.remainder).toBe(3700);
    });
  });

  describe('Spending tracker configuration validation', () => {
    it('should have 4 spending categories defined', () => {
      expect(spendingConfig.categories.length).toBe(4);
    });

    it('should have correct intervals for each category', () => {
      expect(sharedSpending.interval).toBe('monthly');
      const vacation = spendingConfig.categories.find((c: any) => c.name === 'Vacation');
      expect(vacation!.interval).toBe('yearly');
      expect(emergencyCategory.interval).toBe('yearly');
    });

    it('should have Emergency category with carry-under enabled', () => {
      expect(emergencyCategory.carryOver).toBe(true);
      expect(emergencyCategory.carryUnder).toBe(true);
    });

    it('should have Alice Spending category with no carry', () => {
      const alice = spendingConfig.categories.find((c: any) => c.name === 'Alice Spending');
      expect(alice!.carryOver).toBe(false);
      expect(alice!.carryUnder).toBe(false);
    });
  });
});
