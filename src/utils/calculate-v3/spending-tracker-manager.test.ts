import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { SegmentResult } from './types';

// Mock the variable resolution functions to avoid filesystem access
vi.mock('../simulation/loadVariableValue', () => ({
  loadNumberOrVariable: vi.fn(
    (amount: number, isVariable: boolean, variable: string | null, _simulation: string) => ({
      amount: amount,
      amountIsVariable: isVariable,
      amountVariable: variable,
    }),
  ),
  loadDateOrVariable: vi.fn(
    (date: string, isVariable: boolean, variable: string | null, _simulation: string) => ({
      date: new Date(date),
      dateIsVariable: isVariable,
      dateVariable: variable,
    }),
  ),
}));

import { SpendingTrackerManager } from './spending-tracker-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a UTC date */
function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** Build a SpendingTrackerCategory with sensible defaults */
function makeCategory(overrides: Partial<SpendingTrackerCategory> = {}): SpendingTrackerCategory {
  return {
    id: 'test-cat-1',
    name: 'Test Category',
    threshold: 150,
    thresholdIsVariable: false,
    thresholdVariable: null,
    interval: 'weekly',
    intervalStart: 'Saturday',
    accountId: 'account-1',
    carryOver: false,
    carryUnder: false,
    increaseBy: 0,
    increaseByIsVariable: false,
    increaseByVariable: null,
    increaseByDate: '01/01',
    thresholdChanges: [],
    ...overrides,
  };
}

/** Build a SegmentResult with given activities keyed by account */
function makeSegmentResult(activities: Record<string, any[]>): SegmentResult {
  return {
    balanceChanges: new Map(),
    activitiesAdded: new Map(Object.entries(activities)),
    processedEventIds: new Set(),
    balanceMinimums: new Map(),
    balanceMaximums: new Map(),
    taxableOccurences: new Map(),
    spendingTrackerUpdates: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SpendingTrackerManager', () => {
  const startDate = utcDate(2025, 1, 1);
  const simulation = 'test-sim';

  // -----------------------------------------------------------------------
  // 1. Construction & Variable Resolution
  // -----------------------------------------------------------------------
  describe('Construction & Variable Resolution', () => {
    it('should create manager with non-variable categories', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      expect(mgr).toBeDefined();
      const config = mgr.getCategoryConfig('test-cat-1');
      expect(config.threshold).toBe(150);
      expect(config.increaseBy).toBe(0);
    });

    it('should resolve threshold and increaseBy at construction time', () => {
      const cat = makeCategory({ threshold: 200, increaseBy: 0.05 });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      const config = mgr.getCategoryConfig('test-cat-1');
      expect(config.threshold).toBe(200);
      expect(config.increaseBy).toBe(0.05);
    });

    it('should resolve threshold changes and sort chronologically', () => {
      const cat = makeCategory({
        thresholdChanges: [
          {
            date: '2026-06-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 300,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
          {
            date: '2025-06-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 200,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
        ],
      });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      const config = mgr.getCategoryConfig('test-cat-1');
      // After sorting, 2025-06-01 should come first
      expect(config.thresholdChanges[0].newThreshold).toBe(200);
      expect(config.thresholdChanges[1].newThreshold).toBe(300);
    });

    it('should initialize carry balance and period spending to zero', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(0);
      // carryBalance starts at 0 so effective threshold == base threshold
      const { effectiveThreshold, baseThreshold } = mgr.getEffectiveThreshold('test-cat-1', startDate);
      expect(effectiveThreshold).toBe(baseThreshold);
    });

    it('should throw for unknown category ID', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      expect(() => mgr.getCategoryConfig('nonexistent')).toThrow('unknown category ID');
    });

    it('getEffectiveThreshold throws for unknown category ID', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      expect(() => mgr.getEffectiveThreshold('nonexistent', startDate)).toThrow();
    });

    it('getPeriodSpending throws for unknown category ID', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      expect(() => mgr.getPeriodSpending('nonexistent')).toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 2. Carry Model Math
  // -----------------------------------------------------------------------
  describe('Carry Model Math', () => {
    describe('Basic carry scenarios', () => {
      it('underspend $50, carryOver ON => positive carry consumed by remainder bill, carry resets to 0, next effective=150', () => {
        const cat = makeCategory({ threshold: 150, carryOver: true, carryUnder: false });
        const mgr = new SpendingTrackerManager([cat], simulation, startDate);

        const date = utcDate(2025, 1, 7);
        mgr.updateCarry('test-cat-1', 100, date); // spent 100, threshold 150 => underspend 50
        // carry = 0 + (150 - 100) = +50, but positive carry is always consumed by remainder bill => reset to 0
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(150); // 150 + 0 (positive carry reset to 0)
      });

      it('overspend $50, carryUnder ON => carryBalance=-50, next effective=100', () => {
        const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: true });
        const mgr = new SpendingTrackerManager([cat], simulation, startDate);

        const date = utcDate(2025, 1, 7);
        mgr.updateCarry('test-cat-1', 200, date); // spent 200, threshold 150 => overspend 50
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(100); // 150 + (-50)
      });

      it('carryOver OFF, underspend $50 => carryBalance=0, effective=150', () => {
        const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: false });
        const mgr = new SpendingTrackerManager([cat], simulation, startDate);

        const date = utcDate(2025, 1, 7);
        mgr.updateCarry('test-cat-1', 100, date); // underspend 50 but carryOver OFF
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(150); // carry zeroed out
      });

      it('carryUnder OFF, overspend $50 => carryBalance=0, effective=150', () => {
        const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: false });
        const mgr = new SpendingTrackerManager([cat], simulation, startDate);

        const date = utcDate(2025, 1, 7);
        mgr.updateCarry('test-cat-1', 200, date); // overspend 50 but carryUnder OFF
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(150);
      });

      it('both OFF => carry always 0', () => {
        const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: false });
        const mgr = new SpendingTrackerManager([cat], simulation, startDate);

        // Underspend
        mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));
        expect(mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 14)).effectiveThreshold).toBe(150);

        // Overspend
        mgr.updateCarry('test-cat-1', 200, utcDate(2025, 1, 14));
        expect(mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 21)).effectiveThreshold).toBe(150);
      });
    });

    describe('Indefinite debt accumulation (carryUnder ON)', () => {
      let mgr: SpendingTrackerManager;

      beforeEach(() => {
        const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: true });
        mgr = new SpendingTrackerManager([cat], simulation, startDate);
      });

      it('Week 1: spend $500 on $150 threshold => carry = -350', () => {
        mgr.updateCarry('test-cat-1', 500, utcDate(2025, 1, 7));
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 14));
        // carry = 0 + (150 - 500) = -350, effective = max(0, 150 + (-350)) = 0
        expect(effectiveThreshold).toBe(0);
      });

      it('Week 2: spend $0, negative carry accumulates: carry = -350 + 150 = -200, effective=0', () => {
        mgr.updateCarry('test-cat-1', 500, utcDate(2025, 1, 7)); // carry = 0+(150-500) = -350
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 14));  // carry = -350+(150-0) = -200 (negative persists)
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 21));
        expect(effectiveThreshold).toBe(0); // max(0, 150 + (-200)) = 0
      });

      it('Week 3: spend $0, negative carry accumulates: carry = -200 + 150 = -50, effective=100', () => {
        mgr.updateCarry('test-cat-1', 500, utcDate(2025, 1, 7));  // carry = -350
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 14));   // carry = -200
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 21));   // carry = -200+(150-0) = -50 (negative persists)
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 28));
        expect(effectiveThreshold).toBe(100); // max(0, 150 + (-50)) = 100
      });

      it('Week 4: spend $0, debt fully paid off: carry = -50 + 150 = +100 => reset to 0, effective=100 (carry was -50 at start)', () => {
        mgr.updateCarry('test-cat-1', 500, utcDate(2025, 1, 7));  // carry = -350
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 14));   // carry = -200
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 21));   // carry = -50
        // Before updating carry for week 4, effective = max(0, 150 + (-50)) = 100, remainder = 100
        const remainder = mgr.computeRemainder('test-cat-1', 0, utcDate(2025, 1, 28));
        expect(remainder).toBe(100);

        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 28)); // carry = -50+(150-0) = +100, positive => reset to 0
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 2, 4));
        expect(effectiveThreshold).toBe(150); // carry reset to 0, effective = 150
      });
    });

    describe('Combined carry-over + carry-under (both ON)', () => {
      let mgr: SpendingTrackerManager;

      beforeEach(() => {
        const cat = makeCategory({ threshold: 150, carryOver: true, carryUnder: true });
        mgr = new SpendingTrackerManager([cat], simulation, startDate);
      });

      it('Week 1: spend $100, base $150, carry(start)=$0, effective=$150, remainder=$50, carry(end)=+$50', () => {
        const date = utcDate(2025, 1, 7);
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(150);

        const remainder = mgr.computeRemainder('test-cat-1', 100, date);
        expect(remainder).toBe(50);

        mgr.updateCarry('test-cat-1', 100, date); // carry = 150 - 100 = +50
      });

      it('Week 2: spend $250, base $150, carry(start)=0 (positive reset), effective=$150, remainder=$0, carry(end)=-$100', () => {
        mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7)); // carry = 0+(150-100)=+50, positive => reset to 0

        const date = utcDate(2025, 1, 14);
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(150); // 150 + 0 (carry was reset to 0)

        const remainder = mgr.computeRemainder('test-cat-1', 250, date);
        expect(remainder).toBe(0); // max(0, 150 - 250) = 0

        mgr.updateCarry('test-cat-1', 250, date); // carry = 0+(150-250) = -100 (negative persists)
      });

      it('Week 3: spend $0, base $150, carry(start)=-$100, effective=$50, remainder=$50, carry(end)=0 (positive reset)', () => {
        mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));  // carry = +50 => reset to 0
        mgr.updateCarry('test-cat-1', 250, utcDate(2025, 1, 14)); // carry = 0+(150-250) = -100

        const date = utcDate(2025, 1, 21);
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(50); // max(0, 150 + (-100)) = 50

        const remainder = mgr.computeRemainder('test-cat-1', 0, date);
        expect(remainder).toBe(50);

        mgr.updateCarry('test-cat-1', 0, date); // carry = -100+(150-0) = +50, positive => reset to 0
      });

      it('Week 4: spend $0, base $150, carry(start)=0 (positive reset), effective=$150, remainder=$150', () => {
        mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));  // carry = +50 => 0
        mgr.updateCarry('test-cat-1', 250, utcDate(2025, 1, 14)); // carry = -100
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 21));   // carry = +50 => 0

        const date = utcDate(2025, 1, 28);
        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', date);
        expect(effectiveThreshold).toBe(150); // 150 + 0 (carry was reset to 0)

        const remainder = mgr.computeRemainder('test-cat-1', 0, date);
        expect(remainder).toBe(150);

        mgr.updateCarry('test-cat-1', 0, date); // carry = 0+(150-0) = +150, positive => reset to 0
      });

      it('Full 4-week scenario produces correct final carry (0, since positive carry always resets)', () => {
        mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));  // carry = +50 => 0
        mgr.updateCarry('test-cat-1', 250, utcDate(2025, 1, 14)); // carry = -100
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 21));   // carry = +50 => 0
        mgr.updateCarry('test-cat-1', 0, utcDate(2025, 1, 28));   // carry = +150 => 0

        const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 2, 4));
        expect(effectiveThreshold).toBe(150); // 150 + 0 (carry reset to 0)
      });
    });

    describe('alternating carry with both ON', () => {
      it('positive carry always resets to 0; negative carry accumulates across alternating over/under-spends', () => {
        const cat = makeCategory({ threshold: 150, carryOver: true, carryUnder: true });
        const mgr = new SpendingTrackerManager([cat], simulation, startDate);

        // Period 1: underspend by 30 => carry = 0+(150-120) = +30, positive => reset to 0
        mgr.updateCarry('test-cat-1', 120, utcDate(2025, 1, 7));
        expect(mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 14)).effectiveThreshold).toBe(150); // 150+0

        // Period 2: overspend by 80 => carry = 0+(150-230) = -80 (negative persists)
        mgr.updateCarry('test-cat-1', 230, utcDate(2025, 1, 14));
        expect(mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 21)).effectiveThreshold).toBe(70); // 150+(-80)

        // Period 3: underspend by 100 => carry = -80+(150-50) = +20, positive => reset to 0
        mgr.updateCarry('test-cat-1', 50, utcDate(2025, 1, 21));
        expect(mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 28)).effectiveThreshold).toBe(150); // 150+0
      });
    });
  });

  // -----------------------------------------------------------------------
  // 3. Threshold Resolution
  // -----------------------------------------------------------------------
  describe('Threshold Resolution', () => {
    it('returns base threshold without inflation or changes', () => {
      const cat = makeCategory({ threshold: 150, increaseBy: 0 });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      expect(mgr.resolveThreshold('test-cat-1', utcDate(2025, 6, 15))).toBe(150);
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2030, 12, 31))).toBe(150);
    });

    it('applies annual inflation on increaseByDate', () => {
      // 3% annual inflation on 01/01, startDate = 2025-01-01
      const cat = makeCategory({ threshold: 150, increaseBy: 0.03, increaseByDate: '01/01' });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Before first inflation milestone (still in 2025, milestone 01/01 is not after startDate so first is 2026-01-01)
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2025, 6, 15))).toBe(150);

      // After first inflation (2026-01-01)
      const afterFirst = mgr.resolveThreshold('test-cat-1', utcDate(2026, 1, 1));
      expect(afterFirst).toBeCloseTo(150 * 1.03, 2); // 154.50

      // After second inflation (2027-01-01) — compounds
      const afterSecond = mgr.resolveThreshold('test-cat-1', utcDate(2027, 1, 1));
      expect(afterSecond).toBeCloseTo(150 * 1.03 * 1.03, 2); // ~159.135
    });

    it('threshold change replaces base entirely', () => {
      const cat = makeCategory({
        threshold: 150,
        increaseBy: 0,
        thresholdChanges: [
          {
            date: '2025-06-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 250,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
        ],
      });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Before change
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2025, 5, 31))).toBe(150);
      // On change date
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2025, 6, 1))).toBe(250);
      // After change
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2025, 12, 1))).toBe(250);
    });

    it('inflation compounds on NEW threshold after change', () => {
      // Start: $150, 3% on 01/01. Change to $250 on 2025-06-01
      const cat = makeCategory({
        threshold: 150,
        increaseBy: 0.03,
        increaseByDate: '01/01',
        thresholdChanges: [
          {
            date: '2025-06-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 250,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
        ],
      });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // After change but before first inflation on new threshold
      // The reference date for inflation resets to the change date (2025-06-01)
      // Next milestone is 2026-01-01 (first 01/01 after 2025-06-01)
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2025, 12, 31))).toBe(250);

      // After first inflation on new threshold (2026-01-01)
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2026, 1, 1))).toBeCloseTo(250 * 1.03, 2);

      // After second inflation (2027-01-01)
      expect(mgr.resolveThreshold('test-cat-1', utcDate(2027, 1, 1))).toBeCloseTo(250 * 1.03 * 1.03, 2);
    });

    it('resetCarry true resets carryBalance to 0 (demonstrates effect on negative carry)', () => {
      const cat = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: true,
        thresholdChanges: [
          {
            date: '2025-03-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 200,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: true,
          },
        ],
      });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Underspend: carry = 0+(150-100) = +50, positive => reset to 0
      mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));
      expect(mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 14)).effectiveThreshold).toBe(150); // 150+0

      // Update carry on the threshold change date (resetCarry triggers)
      // carry = 0+(200-100) = +100, positive => reset to 0, then resetCarry also zeroes -> still 0
      mgr.updateCarry('test-cat-1', 100, utcDate(2025, 3, 1));
      const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 3, 8));
      expect(effectiveThreshold).toBe(200); // base = 200, carry = 0
    });

    it('resetCarry false continues carry against new base (positive carry still resets to 0)', () => {
      const cat = makeCategory({
        threshold: 150,
        carryOver: true,
        carryUnder: true,
        thresholdChanges: [
          {
            date: '2025-03-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 200,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
        ],
      });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Underspend by 50: carry = 0+(150-100) = +50, positive => reset to 0
      mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));

      // Update carry on the threshold change date (no resetCarry)
      // Base threshold is now 200, carry = 0+(200-150) = +50, positive => reset to 0
      mgr.updateCarry('test-cat-1', 150, utcDate(2025, 3, 1));
      const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 3, 8));
      expect(effectiveThreshold).toBe(200); // 200 + 0 (positive carry reset)
    });
  });

  // -----------------------------------------------------------------------
  // 4. Remainder Computation
  // -----------------------------------------------------------------------
  describe('Remainder Computation', () => {
    it('remainder = max(0, effectiveThreshold - totalSpent)', () => {
      const cat = makeCategory({ threshold: 150 });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      expect(mgr.computeRemainder('test-cat-1', 50, startDate)).toBe(100);
    });

    it('zero remainder when spending exceeds threshold', () => {
      const cat = makeCategory({ threshold: 150 });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      expect(mgr.computeRemainder('test-cat-1', 200, startDate)).toBe(0);
    });

    it('remainder with positive carry reset: carry=0, effective=base, remainder = base - spent', () => {
      const cat = makeCategory({ threshold: 150, carryOver: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Underspend 50: carry = 0+(150-100) = +50, positive => reset to 0
      mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));

      // effective = 150 + 0 = 150 (carry was reset), spent 80 => remainder = 70
      expect(mgr.computeRemainder('test-cat-1', 80, utcDate(2025, 1, 14))).toBe(70);
    });

    it('correct remainder with negative carry adjustment', () => {
      const cat = makeCategory({ threshold: 150, carryUnder: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Build carry: overspend 100 => carry = -100
      mgr.updateCarry('test-cat-1', 250, utcDate(2025, 1, 7));

      // effective = max(0, 150 - 100) = 50, spent 30 => remainder = 20
      expect(mgr.computeRemainder('test-cat-1', 30, utcDate(2025, 1, 14))).toBe(20);
    });

    it('effective threshold cannot go below 0', () => {
      const cat = makeCategory({ threshold: 150, carryUnder: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Overspend by 500 => carry = -500
      mgr.updateCarry('test-cat-1', 650, utcDate(2025, 1, 7));

      const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 14));
      expect(effectiveThreshold).toBe(0); // clamped
      expect(mgr.computeRemainder('test-cat-1', 0, utcDate(2025, 1, 14))).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 5. recordSegmentActivities
  // -----------------------------------------------------------------------
  describe('recordSegmentActivities', () => {
    // When lastProcessedPeriodEnd is null (before any spending tracker event fires),
    // activities accumulate directly into periodSpending. Virtual events will
    // process these via the normal carry logic. These tests simulate
    // the normal case where a period has already been processed.

    it('accumulates negative amounts (expenses) correctly', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1)); // enable direct accumulation

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-05' },
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-06' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(80);
    });

    it('positive amounts (refunds) reduce period spending', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-05' },
          { amount: 25, spendingCategory: 'test-cat-1', date: '2025-01-06' }, // refund
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(25); // 50 - 25 = 25
    });

    it('periodSpending goes negative when refunds exceed expenses (net refund increases budget)', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -20, spendingCategory: 'test-cat-1', date: '2025-01-05' },
          { amount: 50, spendingCategory: 'test-cat-1', date: '2025-01-06' }, // refund larger than expense
        ],
      });
      mgr.recordSegmentActivities(segment);
      // Negative periodSpending means net refunds exceed expenses,
      // which increases the effective remaining budget.
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(-30); // 20 - 50 = -30
    });

    it('skips activities with null spendingCategory', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: null, date: '2025-01-05' },
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-06' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(30);
    });

    it('skips activities with non-matching spendingCategory', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'other-category', date: '2025-01-05' },
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-06' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(30);
    });

    it('skips zero-amount activities', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [{ amount: 0, spendingCategory: 'test-cat-1', date: '2025-01-05' }],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(0);
    });

    it('respects lastProcessedPeriodEnd (skips activities from closed periods)', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Mark period through Jan 5 as processed
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 5));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-04' }, // before cutoff
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-05' }, // on cutoff (not after)
          { amount: -20, spendingCategory: 'test-cat-1', date: '2025-01-06' }, // after cutoff
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(20); // only the Jan 6 activity
    });

    it('accumulates from multiple accounts in same segment', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [{ amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-05' }],
        'account-2': [{ amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-06' }],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(80);
    });

    it('handles activities with non-numeric amounts gracefully', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: 'not-a-number', spendingCategory: 'test-cat-1', date: '2025-01-05' },
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-06' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      // Non-numeric treated as 0, which is >= 0, so skipped
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(50);
    });

    it('accumulates activities into periodSpending even when lastProcessedPeriodEnd is null (virtual events will process)', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      // Do NOT call markPeriodProcessed — simulates pre-first-event state

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-02' },
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-05' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      // Activities go directly into periodSpending (virtual events will process them)
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(80);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Checkpoint / Restore
  // -----------------------------------------------------------------------
  describe('Checkpoint / Restore', () => {
    it('checkpoint saves state, restore reverts to checkpoint', () => {
      const cat = makeCategory({ threshold: 150, carryOver: true, carryUnder: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Modify state: carry = 0+(150-100) = +50, positive => reset to 0
      mgr.updateCarry('test-cat-1', 100, utcDate(2025, 1, 7));
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 7)); // enable direct accumulation
      const segment = makeSegmentResult({
        'account-1': [{ amount: -40, spendingCategory: 'test-cat-1', date: '2025-01-08' }],
      });
      mgr.recordSegmentActivities(segment); // periodSpending = 40
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 10));

      // Checkpoint (carry is 0 since positive carry was reset)
      mgr.checkpoint();

      // Further changes
      mgr.updateCarry('test-cat-1', 200, utcDate(2025, 1, 14)); // changes carry
      const segment2 = makeSegmentResult({
        'account-1': [{ amount: -60, spendingCategory: 'test-cat-1', date: '2025-01-15' }],
      });
      mgr.recordSegmentActivities(segment2); // periodSpending increased

      // Verify state changed
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(100); // 40 + 60

      // Restore
      mgr.restore();

      // Verify reverted to checkpoint
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(40);
      const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 14));
      expect(effectiveThreshold).toBe(150); // 150 + 0 carry (positive carry was reset before checkpoint)
    });

    it('after restore, processing produces same results (no double-counting)', () => {
      const cat = makeCategory({ threshold: 150, carryOver: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1)); // enable direct accumulation

      // Initial processing
      const segment = makeSegmentResult({
        'account-1': [{ amount: -75, spendingCategory: 'test-cat-1', date: '2025-01-08' }],
      });
      mgr.recordSegmentActivities(segment);
      mgr.checkpoint();

      // Process more
      const segment2 = makeSegmentResult({
        'account-1': [{ amount: -25, spendingCategory: 'test-cat-1', date: '2025-01-09' }],
      });
      mgr.recordSegmentActivities(segment2);

      // Restore
      mgr.restore();

      // Re-process segment2
      mgr.recordSegmentActivities(segment2);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(100); // 75 + 25, not 75 + 25 + 25
    });

    it('lastProcessedPeriodEnd is also checkpointed/restored', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 10));
      mgr.checkpoint();

      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 20));

      mgr.restore();

      // After restore, activities on Jan 15 should be counted (> Jan 10 checkpoint)
      // but activities on Jan 8 should be skipped (<= Jan 10)
      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-08' },
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-15' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(30); // only the Jan 15 activity
    });
  });

  // -----------------------------------------------------------------------
  // 7. markPeriodProcessed
  // -----------------------------------------------------------------------
  describe('markPeriodProcessed', () => {
    it('sets lastProcessedPeriodEnd correctly', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 10));

      // Activities on or before Jan 10 should be skipped
      const segment = makeSegmentResult({
        'account-1': [
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-10' },
          { amount: -30, spendingCategory: 'test-cat-1', date: '2025-01-11' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(30);
    });

    it('affects subsequent recordSegmentActivities calls', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1)); // enable direct accumulation

      // First segment: period processed, activities after cutoff count
      const segment1 = makeSegmentResult({
        'account-1': [{ amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-05' }],
      });
      mgr.recordSegmentActivities(segment1);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(50);

      // Mark period
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 7));

      // Second segment: activities before Jan 7 should be skipped
      const segment2 = makeSegmentResult({
        'account-1': [
          { amount: -20, spendingCategory: 'test-cat-1', date: '2025-01-06' }, // skipped
          { amount: -10, spendingCategory: 'test-cat-1', date: '2025-01-08' }, // counted
        ],
      });
      mgr.recordSegmentActivities(segment2);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(60); // 50 + 10
    });

    it('throws for unknown category ID', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      expect(() => mgr.markPeriodProcessed('nonexistent', utcDate(2025, 1, 10))).toThrow(
        'no state for category ID',
      );
    });
  });

  // -----------------------------------------------------------------------
  // resetPeriodSpending
  // -----------------------------------------------------------------------
  describe('resetPeriodSpending', () => {
    it('resets period spending to 0', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 1)); // enable direct accumulation

      const segment = makeSegmentResult({
        'account-1': [{ amount: -80, spendingCategory: 'test-cat-1', date: '2025-01-05' }],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(80);

      mgr.resetPeriodSpending('test-cat-1');
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(0);
    });

    it('throws for unknown category ID', () => {
      const cat = makeCategory();
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      expect(() => mgr.resetPeriodSpending('nonexistent')).toThrow('no state for category ID');
    });
  });

  // -----------------------------------------------------------------------
  // Multiple categories
  // -----------------------------------------------------------------------
  describe('Multiple categories', () => {
    it('tracks categories independently', () => {
      const cat1 = makeCategory({ id: 'cat-a', name: 'A', threshold: 100 });
      const cat2 = makeCategory({ id: 'cat-b', name: 'B', threshold: 200, carryOver: true });
      const mgr = new SpendingTrackerManager([cat1, cat2], simulation, startDate);
      mgr.markPeriodProcessed('cat-a', utcDate(2025, 1, 1));
      mgr.markPeriodProcessed('cat-b', utcDate(2025, 1, 1));

      const segment = makeSegmentResult({
        'account-1': [
          { amount: -30, spendingCategory: 'cat-a', date: '2025-01-05' },
          { amount: -50, spendingCategory: 'cat-b', date: '2025-01-05' },
        ],
      });
      mgr.recordSegmentActivities(segment);

      expect(mgr.getPeriodSpending('cat-a')).toBe(30);
      expect(mgr.getPeriodSpending('cat-b')).toBe(50);

      // Update carry independently
      mgr.updateCarry('cat-a', 30, utcDate(2025, 1, 7)); // cat-a: carry = 0+(100-30)=+70, carryOver OFF => 0, then positive reset => 0
      mgr.updateCarry('cat-b', 50, utcDate(2025, 1, 7)); // cat-b: carry = 0+(200-50)=+150, carryOver ON, but positive carry reset => 0

      expect(mgr.getEffectiveThreshold('cat-a', utcDate(2025, 1, 14)).effectiveThreshold).toBe(100); // 100 + 0
      expect(mgr.getEffectiveThreshold('cat-b', utcDate(2025, 1, 14)).effectiveThreshold).toBe(200); // 200 + 0 (positive carry reset)
    });
  });

  // -----------------------------------------------------------------------
  // Virtual period behavior (replaces processPrePeriodActivities)
  // -----------------------------------------------------------------------
  describe('Virtual period behavior', () => {
    it('activities accumulated before any period processed are available via getPeriodSpending', () => {
      const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Activities accumulate directly into periodSpending now (no pendingActivities)
      const segment = makeSegmentResult({
        'account-1': [
          { amount: -100, spendingCategory: 'test-cat-1', date: '2025-01-02' },
          { amount: -50, spendingCategory: 'test-cat-1', date: '2025-01-06' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(150);
    });

    it('virtual events process carry via updateCarry and set lastProcessedPeriodEnd via markPeriodProcessed', () => {
      const cat = makeCategory({ threshold: 150, carryOver: false, carryUnder: true });
      const mgr = new SpendingTrackerManager([cat], simulation, startDate);

      // Simulate what the calculator does for a virtual event:
      // 1. getPeriodSpending returns accumulated spending
      // 2. computeRemainder calculates remainder
      // 3. updateCarry updates carry balance
      // 4. resetPeriodSpending resets for next period
      // 5. markPeriodProcessed sets lastProcessedPeriodEnd

      // Accumulate $512 of spending
      const segment = makeSegmentResult({
        'account-1': [
          { amount: -512, spendingCategory: 'test-cat-1', date: '2025-01-02' },
        ],
      });
      mgr.recordSegmentActivities(segment);
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(512);

      // Process as virtual event (same steps as calculator but without creating remainder activity)
      const totalSpent = mgr.getPeriodSpending('test-cat-1');
      mgr.updateCarry('test-cat-1', totalSpent, utcDate(2025, 1, 10));
      mgr.resetPeriodSpending('test-cat-1');
      mgr.markPeriodProcessed('test-cat-1', utcDate(2025, 1, 10));

      // carry = 0 + (150 - 512) = -362 (carryUnder ON, persists)
      const { effectiveThreshold } = mgr.getEffectiveThreshold('test-cat-1', utcDate(2025, 1, 17));
      expect(effectiveThreshold).toBe(0); // max(0, 150 + (-362)) = 0
      expect(mgr.getPeriodSpending('test-cat-1')).toBe(0); // reset after virtual event
    });
  });
});
