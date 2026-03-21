import { describe, it, expect } from 'vitest';
import { DeductionTracker } from './deduction-tracker';

describe('DeductionTracker', () => {
  describe('addDeduction', () => {
    it('accumulates deductions correctly by year and category', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 5000);
      tracker.addDeduction(2026, 'mortgageInterest', 3000);
      tracker.addDeduction(2026, 'charitable', 2000);

      const deductions = tracker.getDeductionsByCategory(2026);
      expect(deductions['mortgageInterest']).toBe(8000);
      expect(deductions['charitable']).toBe(2000);
    });

    it('ignores zero and negative amounts', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 5000);
      tracker.addDeduction(2026, 'mortgageInterest', 0);
      tracker.addDeduction(2026, 'mortgageInterest', -100);

      const deductions = tracker.getDeductionsByCategory(2026);
      expect(deductions['mortgageInterest']).toBe(5000);
    });

    it('tracks multiple years independently', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 5000);
      tracker.addDeduction(2027, 'mortgageInterest', 6000);

      expect(tracker.getDeductionsByCategory(2026)['mortgageInterest']).toBe(5000);
      expect(tracker.getDeductionsByCategory(2027)['mortgageInterest']).toBe(6000);
    });
  });

  describe('getItemizedTotal', () => {
    it('sums mortgage interest, SALT-capped state+property, and charitable', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 8000);
      tracker.addDeduction(2026, 'stateTax', 3000);
      tracker.addDeduction(2026, 'propertyTax', 5000);
      tracker.addDeduction(2026, 'charitable', 2000);

      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(8000 + 8000 + 2000); // mortgage + min(3000+5000, 10000) + charitable
    });

    it('applies SALT cap correctly', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'stateTax', 15000);
      tracker.addDeduction(2026, 'propertyTax', 5000);

      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(10000); // Capped at $10,000
    });

    it('returns 0 for years with no deductions', () => {
      const tracker = new DeductionTracker();
      expect(tracker.getItemizedTotal(2026)).toBe(0);
    });

    it('excludes categories not in itemized deduction calculation', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 5000);
      tracker.addDeduction(2026, 'hsaContribution', 5000);
      tracker.addDeduction(2026, 'studentLoanInterest', 1000);

      // Only mortgageInterest counts for itemized
      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(5000);
    });
  });

  describe('getAboveTheLineTotal', () => {
    it('sums HSA, capped student loan interest, and traditional IRA', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'hsaContribution', 3000);
      tracker.addDeduction(2026, 'studentLoanInterest', 2000);
      tracker.addDeduction(2026, 'traditionalIRA', 5000);

      const total = tracker.getAboveTheLineTotal(2026);
      expect(total).toBe(3000 + 2000 + 5000);
    });

    it('caps student loan interest at $2,500', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'studentLoanInterest', 5000);

      const total = tracker.getAboveTheLineTotal(2026);
      expect(total).toBe(2500);
    });

    it('returns 0 for years with no above-the-line deductions', () => {
      const tracker = new DeductionTracker();
      expect(tracker.getAboveTheLineTotal(2026)).toBe(0);
    });

    it('excludes categories not in above-the-line calculation', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'hsaContribution', 3000);
      tracker.addDeduction(2026, 'mortgageInterest', 5000);
      tracker.addDeduction(2026, 'charitable', 2000);

      // Only HSA counts for above-the-line
      const total = tracker.getAboveTheLineTotal(2026);
      expect(total).toBe(3000);
    });
  });

  describe('getDeductionsByCategory', () => {
    it('returns correct breakdown by category', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 8000);
      tracker.addDeduction(2026, 'charitable', 2000);
      tracker.addDeduction(2026, 'hsaContribution', 3000);

      const deductions = tracker.getDeductionsByCategory(2026);
      expect(deductions['mortgageInterest']).toBe(8000);
      expect(deductions['charitable']).toBe(2000);
      expect(deductions['hsaContribution']).toBe(3000);
    });

    it('returns empty object for years with no deductions', () => {
      const tracker = new DeductionTracker();
      const deductions = tracker.getDeductionsByCategory(2026);
      expect(deductions).toEqual({});
    });
  });

  describe('checkpoint and restore', () => {
    it('preserves all deductions after checkpoint and restore', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 8000);
      tracker.addDeduction(2026, 'charitable', 2000);
      tracker.addDeduction(2027, 'hsaContribution', 3000);

      tracker.checkpoint();
      tracker.restore();

      expect(tracker.getDeductionsByCategory(2026)['mortgageInterest']).toBe(8000);
      expect(tracker.getDeductionsByCategory(2026)['charitable']).toBe(2000);
      expect(tracker.getDeductionsByCategory(2027)['hsaContribution']).toBe(3000);
    });

    it('restores correctly without a prior checkpoint', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'mortgageInterest', 8000);

      tracker.restore();

      expect(tracker.getDeductionsByCategory(2026)['mortgageInterest']).toBe(8000);
    });
  });

  describe('SALT cap edge cases', () => {
    it('handles state tax only (no property tax)', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'stateTax', 15000);

      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(10000);
    });

    it('handles property tax only (no state tax)', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'propertyTax', 15000);

      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(10000);
    });

    it('combines state and property tax correctly under the cap', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'stateTax', 3000);
      tracker.addDeduction(2026, 'propertyTax', 6000);

      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(9000); // 3000 + 6000 = 9000 (under cap)
    });

    it('caps combined state and property tax at $10,000', () => {
      const tracker = new DeductionTracker();
      tracker.addDeduction(2026, 'stateTax', 7000);
      tracker.addDeduction(2026, 'propertyTax', 7000);

      const total = tracker.getItemizedTotal(2026);
      expect(total).toBe(10000); // Capped at $10,000
    });
  });

  describe('with debug logger', () => {
    it('logs deductions when debug logger is provided', () => {
      const logs: any[] = [];
      const mockLogger = {
        log: (simNumber: number, data: Record<string, unknown>) => {
          logs.push({ simNumber, data });
        },
      };

      const tracker = new DeductionTracker(mockLogger as any, 1);
      tracker.addDeduction(2026, 'mortgageInterest', 5000);

      expect(logs.length).toBe(1);
      expect(logs[0].data.component).toBe('deduction-tracker');
      expect(logs[0].data.event).toBe('deduction-added');
      expect(logs[0].data.year).toBe(2026);
      expect(logs[0].data.category).toBe('mortgageInterest');
    });

    it('logs checkpoint and restore events', () => {
      const logs: any[] = [];
      const mockLogger = {
        log: (simNumber: number, data: Record<string, unknown>) => {
          logs.push({ simNumber, data });
        },
      };

      const tracker = new DeductionTracker(mockLogger as any, 1);
      tracker.addDeduction(2026, 'mortgageInterest', 5000);
      tracker.checkpoint();
      tracker.restore();

      const events = logs.map(l => l.data.event);
      expect(events).toContain('checkpoint-saved');
      expect(events).toContain('checkpoint-restored');
    });

    it('includes current date in log entries when set', () => {
      const logs: any[] = [];
      const mockLogger = {
        log: (simNumber: number, data: Record<string, unknown>) => {
          logs.push({ simNumber, data });
        },
      };

      const tracker = new DeductionTracker(mockLogger as any, 1);
      tracker.setCurrentDate('2026-01-15');
      tracker.addDeduction(2026, 'mortgageInterest', 5000);

      expect(logs[0].data.ts).toBe('2026-01-15');
    });
  });

  describe('multiple years and categories', () => {
    it('handles complex multi-year, multi-category scenarios', () => {
      const tracker = new DeductionTracker();

      // Year 2026
      tracker.addDeduction(2026, 'mortgageInterest', 8000);
      tracker.addDeduction(2026, 'stateTax', 3000);
      tracker.addDeduction(2026, 'propertyTax', 4000);
      tracker.addDeduction(2026, 'charitable', 1500);
      tracker.addDeduction(2026, 'hsaContribution', 2000);

      // Year 2027
      tracker.addDeduction(2027, 'mortgageInterest', 9000);
      tracker.addDeduction(2027, 'stateTax', 4000);
      tracker.addDeduction(2027, 'propertyTax', 6000);
      tracker.addDeduction(2027, 'charitable', 2000);
      tracker.addDeduction(2027, 'studentLoanInterest', 2500);

      // Verify year 2026 calculations
      expect(tracker.getItemizedTotal(2026)).toBe(8000 + 7000 + 1500); // mortgage + min(3000+4000, 10000) + charitable
      expect(tracker.getAboveTheLineTotal(2026)).toBe(2000); // HSA only

      // Verify year 2027 calculations
      expect(tracker.getItemizedTotal(2027)).toBe(9000 + 10000 + 2000); // mortgage + min(4000+6000, 10000) + charitable
      expect(tracker.getAboveTheLineTotal(2027)).toBe(2500); // capped student loan
    });
  });
});
