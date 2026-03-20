import { describe, it, expect, beforeEach } from 'vitest';
import { PaycheckStateTracker } from './paycheck-state-tracker';

describe('PaycheckStateTracker', () => {
  let tracker: PaycheckStateTracker;

  beforeEach(() => {
    tracker = new PaycheckStateTracker();
  });

  describe('SS wage cap enforcement', () => {
    it('should allow wages below the annual cap', () => {
      const personKey = 'person-1';
      const year = 2026;
      const annualCap = 168600;

      const taxable = tracker.addSSWages(personKey, year, 5000, annualCap);
      expect(taxable).toBe(5000);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(5000);
    });

    it('should enforce the annual cap', () => {
      const personKey = 'person-1';
      const year = 2026;
      const annualCap = 168600;

      // Add wages up to the cap
      tracker.addSSWages(personKey, year, 168000, annualCap);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(168000);

      // Try to add more, should be limited
      const taxable = tracker.addSSWages(personKey, year, 1000, annualCap);
      expect(taxable).toBe(600); // Only 600 fits under the cap
      expect(tracker.getYTDSSWages(personKey, year)).toBe(168600);
    });

    it('should return zero when already at cap', () => {
      const personKey = 'person-1';
      const year = 2026;
      const annualCap = 168600;

      // Reach the cap
      tracker.addSSWages(personKey, year, annualCap, annualCap);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(annualCap);

      // Try to add more, should return 0
      const taxable = tracker.addSSWages(personKey, year, 5000, annualCap);
      expect(taxable).toBe(0);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(annualCap);
    });
  });

  describe('SS wages for 26 biweekly paychecks', () => {
    it('should handle biweekly paycheck schedule and enforce cap midyear', () => {
      const personKey = 'person-1';
      const year = 2026;
      const annualCap = 168600;
      const paycheckAmount = 6500;

      // 26 biweekly paychecks of $6500
      let totalTaxable = 0;
      for (let i = 0; i < 26; i++) {
        const taxable = tracker.addSSWages(personKey, year, paycheckAmount, annualCap);
        totalTaxable += taxable;
      }

      // Should hit the cap before paycheck 26
      expect(tracker.getYTDSSWages(personKey, year)).toBe(annualCap);
      expect(totalTaxable).toBe(annualCap);

      // Verify cap kicks in around paycheck 25-26
      // 168600 / 6500 = 25.94, so 25th paycheck should be full, 26th should be partial or zero
      const paychecksThatFitUnderCap = Math.floor(annualCap / paycheckAmount);
      expect(paychecksThatFitUnderCap).toBe(25);
    });
  });

  describe('Additional Medicare threshold', () => {
    it('should detect wages below $200K threshold (single)', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 200000;

      const result = tracker.addMedicareWages(personKey, year, 50000, threshold);
      expect(result.totalMedicareWages).toBe(50000);
      expect(result.additionalMedicareApplies).toBe(false);
      expect(result.wagesAboveThreshold).toBe(0);
      expect(result.wagesBelowThreshold).toBe(50000);
    });

    it('should detect wages at threshold', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 200000;

      const result = tracker.addMedicareWages(personKey, year, 200000, threshold);
      expect(result.totalMedicareWages).toBe(200000);
      expect(result.additionalMedicareApplies).toBe(false); // exactly at threshold doesn't apply
      expect(result.wagesAboveThreshold).toBe(0);
      expect(result.wagesBelowThreshold).toBe(200000);
    });

    it('should detect wages above $250K threshold (MFJ)', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 250000;

      const result = tracker.addMedicareWages(personKey, year, 260000, threshold);
      expect(result.totalMedicareWages).toBe(260000);
      expect(result.additionalMedicareApplies).toBe(true);
      expect(result.wagesAboveThreshold).toBe(10000);
      expect(result.wagesBelowThreshold).toBe(250000);
    });
  });

  describe('Medicare wages crossing threshold', () => {
    it('should split wages when single paycheck crosses threshold', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 200000;

      // First paycheck: $195k (below threshold)
      const result1 = tracker.addMedicareWages(personKey, year, 195000, threshold);
      expect(result1.totalMedicareWages).toBe(195000);
      expect(result1.additionalMedicareApplies).toBe(false);
      expect(result1.wagesAboveThreshold).toBe(0);
      expect(result1.wagesBelowThreshold).toBe(195000);

      // Second paycheck: $10k (crosses threshold)
      const result2 = tracker.addMedicareWages(personKey, year, 10000, threshold);
      expect(result2.totalMedicareWages).toBe(205000);
      expect(result2.additionalMedicareApplies).toBe(true);
      expect(result2.wagesAboveThreshold).toBe(5000); // $205k - $200k = $5k
      expect(result2.wagesBelowThreshold).toBe(5000); // $200k - $195k = $5k
    });

    it('should correctly track wages already above threshold', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 200000;

      // First paycheck brings us to $210k (above threshold)
      tracker.addMedicareWages(personKey, year, 210000, threshold);

      // Second paycheck: entirely above threshold
      const result = tracker.addMedicareWages(personKey, year, 20000, threshold);
      expect(result.totalMedicareWages).toBe(230000);
      expect(result.additionalMedicareApplies).toBe(true);
      expect(result.wagesAboveThreshold).toBe(20000); // All of it
      expect(result.wagesBelowThreshold).toBe(0);
    });
  });

  describe('Paycheck count in month', () => {
    it('should count paychecks sequentially in a month', () => {
      const billName = 'salary';
      const yearMonth = '2026-01';

      // First paycheck
      const count1 = tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      expect(count1).toBe(0);

      // Second paycheck
      const count2 = tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      expect(count2).toBe(1);

      // Third paycheck
      const count3 = tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      expect(count3).toBe(2);

      // Fourth paycheck (in case of 4 occurrences)
      const count4 = tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      expect(count4).toBe(3);
    });

    it('should track separate counts for different months', () => {
      const billName = 'salary';

      const jan1 = tracker.getAndIncrementPaycheckCount(billName, '2026-01');
      const jan2 = tracker.getAndIncrementPaycheckCount(billName, '2026-01');
      const feb1 = tracker.getAndIncrementPaycheckCount(billName, '2026-02');
      const feb2 = tracker.getAndIncrementPaycheckCount(billName, '2026-02');

      expect(jan1).toBe(0);
      expect(jan2).toBe(1);
      expect(feb1).toBe(0); // Reset for February
      expect(feb2).toBe(1);
    });

    it('should track separate counts for different bills', () => {
      const yearMonth = '2026-01';

      const salary1 = tracker.getAndIncrementPaycheckCount('salary', yearMonth);
      const bonus1 = tracker.getAndIncrementPaycheckCount('bonus', yearMonth);
      const salary2 = tracker.getAndIncrementPaycheckCount('salary', yearMonth);
      const bonus2 = tracker.getAndIncrementPaycheckCount('bonus', yearMonth);

      expect(salary1).toBe(0);
      expect(bonus1).toBe(0);
      expect(salary2).toBe(1);
      expect(bonus2).toBe(1);
    });
  });

  describe('shouldApplyDeduction - perPaycheck', () => {
    it('should always return true for perPaycheck frequency', () => {
      expect(tracker.shouldApplyDeduction('perPaycheck', 0, false)).toBe(true);
      expect(tracker.shouldApplyDeduction('perPaycheck', 1, false)).toBe(true);
      expect(tracker.shouldApplyDeduction('perPaycheck', 2, false)).toBe(true);
      expect(tracker.shouldApplyDeduction('perPaycheck', 3, true)).toBe(true);
      expect(tracker.shouldApplyDeduction('perPaycheck', 10, true)).toBe(true);
    });
  });

  describe('shouldApplyDeduction - monthly', () => {
    it('should return true for first paycheck (index 0)', () => {
      expect(tracker.shouldApplyDeduction('monthly', 0, false)).toBe(true);
    });

    it('should return true for second paycheck (index 1)', () => {
      expect(tracker.shouldApplyDeduction('monthly', 1, false)).toBe(true);
    });

    it('should return false for third+ paycheck (index 2+)', () => {
      expect(tracker.shouldApplyDeduction('monthly', 2, false)).toBe(false);
      expect(tracker.shouldApplyDeduction('monthly', 3, false)).toBe(false);
      expect(tracker.shouldApplyDeduction('monthly', 10, false)).toBe(false);
    });
  });

  describe('shouldApplyDeduction - annual', () => {
    it('should return true only when isFirstPaycheckOfYear is true', () => {
      expect(tracker.shouldApplyDeduction('annual', 0, true)).toBe(true);
      expect(tracker.shouldApplyDeduction('annual', 1, true)).toBe(true); // index doesn't matter for annual
      expect(tracker.shouldApplyDeduction('annual', 2, true)).toBe(true);
      expect(tracker.shouldApplyDeduction('annual', 0, false)).toBe(false);
      expect(tracker.shouldApplyDeduction('annual', 5, false)).toBe(false);
    });
  });

  describe('shouldApplyDeduction - unknown frequency', () => {
    it('should default to perPaycheck behavior', () => {
      expect(tracker.shouldApplyDeduction('unknown', 0, false)).toBe(true);
      expect(tracker.shouldApplyDeduction('unknown', 2, false)).toBe(true);
      expect(tracker.shouldApplyDeduction('quarterly', 1, false)).toBe(true);
    });
  });

  describe('Checkpoint and restore', () => {
    it('should restore SS wages after checkpoint', () => {
      const personKey = 'person-1';
      const year = 2026;
      const annualCap = 168600;

      // Set up initial state
      tracker.addSSWages(personKey, year, 50000, annualCap);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(50000);

      // Checkpoint
      tracker.checkpoint();

      // Modify state
      tracker.addSSWages(personKey, year, 30000, annualCap);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(80000);

      // Restore
      tracker.restore();
      expect(tracker.getYTDSSWages(personKey, year)).toBe(50000);
    });

    it('should restore Medicare wages after checkpoint', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 200000;

      // Set up initial state
      tracker.addMedicareWages(personKey, year, 100000, threshold);
      expect(tracker.getYTDMedicareWages(personKey, year)).toBe(100000);

      // Checkpoint
      tracker.checkpoint();

      // Modify state
      tracker.addMedicareWages(personKey, year, 50000, threshold);
      expect(tracker.getYTDMedicareWages(personKey, year)).toBe(150000);

      // Restore
      tracker.restore();
      expect(tracker.getYTDMedicareWages(personKey, year)).toBe(100000);
    });

    it('should restore paycheck counts after checkpoint', () => {
      const billName = 'salary';
      const yearMonth = '2026-01';

      // Set up initial state
      tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      expect(tracker.getAndIncrementPaycheckCount(billName, yearMonth)).toBe(2);

      // Checkpoint
      tracker.checkpoint();

      // Modify state
      tracker.getAndIncrementPaycheckCount(billName, yearMonth);
      expect(tracker.getAndIncrementPaycheckCount(billName, yearMonth)).toBe(4);

      // Restore
      tracker.restore();
      expect(tracker.getAndIncrementPaycheckCount(billName, yearMonth)).toBe(3);
    });

    it('should restore all state types together', () => {
      const person1 = 'person-1';
      const person2 = 'person-2';
      const year = 2026;
      const ssCapSingle = 168600;
      const medicareSingle = 200000;
      const bill = 'salary';
      const month = '2026-01';

      // Set up multi-person state
      tracker.addSSWages(person1, year, 50000, ssCapSingle);
      tracker.addSSWages(person2, year, 60000, ssCapSingle);
      tracker.addMedicareWages(person1, year, 100000, medicareSingle);
      tracker.addMedicareWages(person2, year, 120000, medicareSingle);
      tracker.getAndIncrementPaycheckCount(bill, month);

      // Checkpoint
      tracker.checkpoint();

      // Modify all three state types
      tracker.addSSWages(person1, year, 20000, ssCapSingle);
      tracker.addMedicareWages(person1, year, 30000, medicareSingle);
      tracker.getAndIncrementPaycheckCount(bill, month);

      // Verify modifications
      expect(tracker.getYTDSSWages(person1, year)).toBe(70000);
      expect(tracker.getYTDMedicareWages(person1, year)).toBe(130000);

      // Restore
      tracker.restore();

      // Verify original state
      expect(tracker.getYTDSSWages(person1, year)).toBe(50000);
      expect(tracker.getYTDSSWages(person2, year)).toBe(60000);
      expect(tracker.getYTDMedicareWages(person1, year)).toBe(100000);
      expect(tracker.getYTDMedicareWages(person2, year)).toBe(120000);
      expect(tracker.getAndIncrementPaycheckCount(bill, month)).toBe(1);
    });
  });

  describe('Multiple persons', () => {
    it('should track SS wages independently for different persons', () => {
      const person1 = 'person-1';
      const person2 = 'person-2';
      const year = 2026;
      const annualCap = 168600;

      tracker.addSSWages(person1, year, 50000, annualCap);
      tracker.addSSWages(person2, year, 80000, annualCap);

      expect(tracker.getYTDSSWages(person1, year)).toBe(50000);
      expect(tracker.getYTDSSWages(person2, year)).toBe(80000);
    });

    it('should track Medicare wages independently for different persons', () => {
      const person1 = 'person-1';
      const person2 = 'person-2';
      const year = 2026;
      const threshold = 200000;

      const result1 = tracker.addMedicareWages(person1, year, 150000, threshold);
      const result2 = tracker.addMedicareWages(person2, year, 250000, threshold);

      expect(result1.totalMedicareWages).toBe(150000);
      expect(result2.totalMedicareWages).toBe(250000);

      expect(tracker.getYTDMedicareWages(person1, year)).toBe(150000);
      expect(tracker.getYTDMedicareWages(person2, year)).toBe(250000);
    });

    it('should enforce cap independently for each person', () => {
      const person1 = 'person-1';
      const person2 = 'person-2';
      const year = 2026;
      const annualCap = 168600;

      // Person 1 at cap
      tracker.addSSWages(person1, year, annualCap, annualCap);
      expect(tracker.getYTDSSWages(person1, year)).toBe(annualCap);

      // Person 2 should still have room
      const taxable = tracker.addSSWages(person2, year, 50000, annualCap);
      expect(taxable).toBe(50000);
      expect(tracker.getYTDSSWages(person2, year)).toBe(50000);
    });
  });

  describe('Year independence', () => {
    it('should track same person in different years without cross-contamination', () => {
      const person = 'person-1';
      const annualCap = 168600;

      tracker.addSSWages(person, 2025, 50000, annualCap);
      tracker.addSSWages(person, 2026, 60000, annualCap);
      tracker.addSSWages(person, 2027, 70000, annualCap);

      expect(tracker.getYTDSSWages(person, 2025)).toBe(50000);
      expect(tracker.getYTDSSWages(person, 2026)).toBe(60000);
      expect(tracker.getYTDSSWages(person, 2027)).toBe(70000);
    });

    it('should enforce cap independently for each year', () => {
      const person = 'person-1';
      const annualCap = 168600;

      // 2026: reach cap
      tracker.addSSWages(person, 2026, annualCap, annualCap);
      let taxable = tracker.addSSWages(person, 2026, 10000, annualCap);
      expect(taxable).toBe(0);

      // 2027: should still have room
      taxable = tracker.addSSWages(person, 2027, 10000, annualCap);
      expect(taxable).toBe(10000);
      expect(tracker.getYTDSSWages(person, 2027)).toBe(10000);
    });

    it('should track Medicare wages independently for each year', () => {
      const person = 'person-1';
      const threshold = 200000;

      const result2025 = tracker.addMedicareWages(person, 2025, 150000, threshold);
      const result2026 = tracker.addMedicareWages(person, 2026, 210000, threshold);

      expect(result2025.totalMedicareWages).toBe(150000);
      expect(result2025.additionalMedicareApplies).toBe(false);

      expect(result2026.totalMedicareWages).toBe(210000);
      expect(result2026.additionalMedicareApplies).toBe(true);
    });
  });

  describe('resetYear', () => {
    it('should clear SS wages for the given year', () => {
      tracker.addSSWages('person1', 2025, 50000, 176100);
      tracker.addSSWages('person1', 2026, 60000, 180000);
      tracker.resetYear(2025);
      expect(tracker.getYTDSSWages('person1', 2025)).toBe(0);
      expect(tracker.getYTDSSWages('person1', 2026)).toBe(60000);
    });

    it('should clear Medicare wages for the given year', () => {
      tracker.addMedicareWages('person1', 2025, 50000, 200000);
      tracker.addMedicareWages('person1', 2026, 60000, 200000);
      tracker.resetYear(2025);
      expect(tracker.getYTDMedicareWages('person1', 2025)).toBe(0);
      expect(tracker.getYTDMedicareWages('person1', 2026)).toBe(60000);
    });

    it('should clear paycheck counts for the given year', () => {
      tracker.getAndIncrementPaycheckCount('paycheck1', '2025-01');
      tracker.getAndIncrementPaycheckCount('paycheck1', '2025-02');
      tracker.getAndIncrementPaycheckCount('paycheck1', '2026-01');
      tracker.resetYear(2025);
      expect(tracker.getAndIncrementPaycheckCount('paycheck1', '2025-01')).toBe(0); // cleared, starts fresh
      expect(tracker.getAndIncrementPaycheckCount('paycheck1', '2026-01')).toBe(1); // not cleared
    });
  });

  describe('Edge cases', () => {
    it('should handle zero wages', () => {
      const personKey = 'person-1';
      const year = 2026;
      const annualCap = 168600;

      const taxable = tracker.addSSWages(personKey, year, 0, annualCap);
      expect(taxable).toBe(0);
      expect(tracker.getYTDSSWages(personKey, year)).toBe(0);
    });

    it('should handle very large wage amounts', () => {
      const personKey = 'person-1';
      const year = 2026;
      const threshold = 200000;

      const result = tracker.addMedicareWages(personKey, year, 1000000, threshold);
      expect(result.totalMedicareWages).toBe(1000000);
      expect(result.additionalMedicareApplies).toBe(true);
      expect(result.wagesAboveThreshold).toBe(800000);
      expect(result.wagesBelowThreshold).toBe(200000);
    });

    it('should handle negative indices gracefully', () => {
      // Negative paycheck index should still be handled
      expect(tracker.shouldApplyDeduction('monthly', -1, false)).toBe(true);
    });

    it('should handle negative SS wages amount', () => {
      const tracker2 = new PaycheckStateTracker();
      const result = tracker2.addSSWages('person1', 2025, -1000, 176100);
      expect(result).toBe(0);
      expect(tracker2.getYTDSSWages('person1', 2025)).toBe(0);
    });

    it('should handle zero annual cap', () => {
      const tracker2 = new PaycheckStateTracker();
      const result = tracker2.addSSWages('person1', 2025, 5000, 0);
      expect(result).toBe(0);
    });

    it('should handle restore without prior checkpoint', () => {
      const tracker2 = new PaycheckStateTracker();
      tracker2.addSSWages('person1', 2025, 50000, 176100);
      tracker2.restore(); // no checkpoint taken
      expect(tracker2.getYTDSSWages('person1', 2025)).toBe(50000); // state unchanged
    });

    it('should return 0 for unknown person/year in getYTDSSWages', () => {
      expect(tracker.getYTDSSWages('unknown', 2025)).toBe(0);
    });

    it('should return 0 for unknown person/year in getYTDMedicareWages', () => {
      expect(tracker.getYTDMedicareWages('unknown', 2025)).toBe(0);
    });
  });
});
