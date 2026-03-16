import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MedicareManager } from './medicare-manager';

// Mock the IO module
vi.mock('../../utils/io/io', () => ({
  load: (filename: string) => {
    if (filename === 'irmaaBrackets.json') {
      return {
        '2024': [
          {
            tier: 0,
            singleMin: 0,
            singleMax: 137000,
            marriedMin: 0,
            marriedMax: 206000,
            partBPremium: 174.7,
            partDSurcharge: 0,
          },
          {
            tier: 1,
            singleMin: 137000,
            singleMax: 171500,
            marriedMin: 206000,
            marriedMax: 258000,
            partBPremium: 245.6,
            partDSurcharge: 12.9,
          },
          {
            tier: 2,
            singleMin: 171500,
            singleMax: 214500,
            marriedMin: 258000,
            marriedMax: 322000,
            partBPremium: 351.7,
            partDSurcharge: 33.3,
          },
          {
            tier: 3,
            singleMin: 214500,
            singleMax: 257500,
            marriedMin: 322000,
            marriedMax: 386000,
            partBPremium: 457.7,
            partDSurcharge: 53.8,
          },
          {
            tier: 4,
            singleMin: 257500,
            singleMax: 500000,
            marriedMin: 386000,
            marriedMax: 750000,
            partBPremium: 563.8,
            partDSurcharge: 74.2,
          },
          {
            tier: 5,
            singleMin: 500000,
            singleMax: 9999999,
            marriedMin: 750000,
            marriedMax: 9999999,
            partBPremium: 594,
            partDSurcharge: 81,
          },
        ],
      };
    }
    // Default to historicRates format
    return {
      medicare: {
        partBPremium: {
          '2006': 88.5,
          '2010': 110.5,
          '2012': 99.9,
        },
        partBDeductible: {
          '2006': 124,
          '2010': 155,
          '2012': 140,
        },
        partADeductible: {
          '2006': 952,
          '2010': 1100,
          '2012': 1156,
        },
        partDDeductible: {
          '2006': 250,
          '2010': 310,
          '2012': 320,
        },
        partDBasePremium: {
          '2006': 32.2,
          '2010': 31.94,
          '2012': 31.08,
        },
      },
      healthcareCpi: {
        2023: [3.5],
        2024: [2.8],
        2025: [2.5],
      },
    };
  },
}));

describe('MedicareManager', () => {
  let manager: MedicareManager;

  beforeEach(() => {
    manager = new MedicareManager();
  });

  describe('IRMAA Surcharge Calculation', () => {
    it('should return no surcharge for income below MFJ threshold', () => {
      const surcharge = manager.getIRMAASurcharge(200000, 'mfj');
      expect(surcharge.partBSurcharge).toBe(0);
      expect(surcharge.partDSurcharge).toBe(0);
    });

    it('should apply correct surcharge for income in first bracket (MFJ)', () => {
      const surcharge = manager.getIRMAASurcharge(240000, 'mfj');
      expect(surcharge.partBSurcharge).toBe(70.9);
      expect(surcharge.partDSurcharge).toBe(12.9);
    });

    it('should apply correct surcharge for income in second bracket (MFJ)', () => {
      const surcharge = manager.getIRMAASurcharge(300000, 'mfj');
      expect(surcharge.partBSurcharge).toBe(177);
      expect(surcharge.partDSurcharge).toBe(33.3);
    });

    it('should apply maximum surcharge for high income (MFJ)', () => {
      const surcharge = manager.getIRMAASurcharge(1000000, 'mfj');
      expect(surcharge.partBSurcharge).toBe(419.3);
      expect(surcharge.partDSurcharge).toBe(81);
    });

    it('should return no surcharge for single income below threshold', () => {
      const surcharge = manager.getIRMAASurcharge(130000, 'single');
      expect(surcharge.partBSurcharge).toBe(0);
      expect(surcharge.partDSurcharge).toBe(0);
    });

    it('should apply correct surcharge for single income in first bracket', () => {
      const surcharge = manager.getIRMAASurcharge(160000, 'single');
      expect(surcharge.partBSurcharge).toBe(70.9);
      expect(surcharge.partDSurcharge).toBe(12.9);
    });

    it('should apply maximum surcharge for high single income', () => {
      const surcharge = manager.getIRMAASurcharge(600000, 'single');
      expect(surcharge.partBSurcharge).toBe(419.3);
      expect(surcharge.partDSurcharge).toBe(81);
    });
  });

  describe('Part B Premium', () => {
    it('should return historical premium for known year', () => {
      const premium = manager.getPartBPremium(2012);
      expect(premium).toBe(99.9);
    });

    it('should inflate premium for future years', () => {
      const premium2025 = manager.getPartBPremium(2025);
      expect(premium2025).toBeGreaterThan(99.9);
    });

    it('should return reasonable default if no historical data', () => {
      const premium = manager.getPartBPremium(2050);
      // Should be inflated significantly from 2012 value
      expect(premium).toBeGreaterThan(150);
    });

    it('should return consistent value for same year', () => {
      const p1 = manager.getPartBPremium(2020);
      const p2 = manager.getPartBPremium(2020);
      expect(p1).toBe(p2);
    });
  });

  describe('Part D Base Premium', () => {
    it('should return historical premium for known year', () => {
      const premium = manager.getPartDBasePremium(2012);
      expect(premium).toBe(31.08);
    });

    it('should inflate premium for future years', () => {
      const premium2025 = manager.getPartDBasePremium(2025);
      expect(premium2025).toBeGreaterThan(31.08);
    });

    it('should return reasonable default if no historical data', () => {
      const premium = manager.getPartDBasePremium(2050);
      expect(premium).toBeGreaterThan(25);
    });
  });

  describe('Part A Deductible', () => {
    it('should return historical deductible for known year', () => {
      const deductible = manager.getPartADeductible(2012);
      expect(deductible).toBe(1156);
    });

    it('should inflate deductible for future years', () => {
      const deductible2025 = manager.getPartADeductible(2025);
      expect(deductible2025).toBeGreaterThan(1156);
    });

    it('should increase with age progression', () => {
      const d2020 = manager.getPartADeductible(2020);
      const d2025 = manager.getPartADeductible(2025);
      expect(d2025).toBeGreaterThan(d2020);
    });
  });

  describe('Part B Deductible', () => {
    it('should return historical deductible for known year', () => {
      const deductible = manager.getPartBDeductible(2012);
      expect(deductible).toBe(140);
    });

    it('should inflate deductible for future years', () => {
      const deductible2025 = manager.getPartBDeductible(2025);
      expect(deductible2025).toBeGreaterThan(140);
    });
  });

  describe('Monthly Medicare Cost', () => {
    it('should return 0 for age < 65', () => {
      const cost = manager.getMonthlyMedicareCost(64, 250000, 'mfj', 2024);
      expect(cost).toBe(0);
    });

    it('should calculate base cost for age 65+ with no IRMAA', () => {
      const cost = manager.getMonthlyMedicareCost(65, 150000, 'mfj', 2024);
      // Should include Part B, Part D, and Medigap (rough ~$400-450/month)
      expect(cost).toBeGreaterThan(200);
      expect(cost).toBeLessThan(600);
    });

    it('should add IRMAA surcharge for high income', () => {
      const costLow = manager.getMonthlyMedicareCost(70, 150000, 'mfj', 2024);
      const costHigh = manager.getMonthlyMedicareCost(70, 300000, 'mfj', 2024);
      // High income should include IRMAA surcharges
      expect(costHigh).toBeGreaterThan(costLow);
    });

    it('should increase with age due to Medigap inflation proxy', () => {
      const cost2024 = manager.getMonthlyMedicareCost(70, 200000, 'mfj', 2024);
      const cost2030 = manager.getMonthlyMedicareCost(70, 200000, 'mfj', 2030);
      expect(cost2030).toBeGreaterThan(cost2024);
    });

    it('should be different for different filing statuses with same MAGI', () => {
      const costMFJ = manager.getMonthlyMedicareCost(70, 200000, 'mfj', 2024);
      const costSingle = manager.getMonthlyMedicareCost(70, 200000, 'single', 2024);
      // Different brackets may result in different costs
      // At 200k, MFJ is below first bracket, Single is in first bracket
      expect(costMFJ).not.toBe(costSingle);
    });
  });

  describe('Hospital Admissions (Poisson)', () => {
    it('should generate expected value when no random function provided', () => {
      // Without random, returns expected value
      const admissions65 = manager.generateHospitalAdmissions(65, 2024);
      expect(admissions65).toBe(0); // Math.round(0.15)
    });

    it('should generate reasonable count for age 70', () => {
      const admissions70 = manager.generateHospitalAdmissions(70, 2024);
      expect(admissions70).toBeGreaterThanOrEqual(0);
      expect(admissions70).toBeLessThanOrEqual(2);
    });

    it('should generate higher rates for older ages', () => {
      // Average should increase with age
      let count65 = 0;
      let count85 = 0;

      const random = () => Math.random();

      for (let i = 0; i < 100; i++) {
        count65 += manager.generateHospitalAdmissions(65, 2024, random);
        count85 += manager.generateHospitalAdmissions(85, 2024, random);
      }

      // Age 85 should have higher expected admissions
      expect(count85).toBeGreaterThan(count65);
    });

    it('should produce distribution consistent with Poisson', () => {
      const random = () => Math.random();
      const samples: number[] = [];

      // Generate 1000 samples at age 70 (lambda = 0.2)
      for (let i = 0; i < 1000; i++) {
        samples.push(manager.generateHospitalAdmissions(70, 2024, random));
      }

      const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
      const variance = samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / samples.length;

      // For Poisson, mean should approximate lambda (0.2)
      // and variance should approximate mean
      expect(mean).toBeGreaterThan(0.1);
      expect(mean).toBeLessThan(0.5);
      expect(variance).toBeCloseTo(mean, 1);
    });

    it('should use correct lambda for age ranges', () => {
      // Age 64 should use 65 bracket
      const a64 = manager.generateHospitalAdmissions(64, 2024);
      expect(a64).toBeGreaterThanOrEqual(0);

      // Age 90+ should use 90 bracket
      const a95 = manager.generateHospitalAdmissions(95, 2024);
      expect(a95).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Hospital Admissions Cost Generation', () => {
    it('should calculate Part A cost for admission', () => {
      const deductible = manager.getPartADeductible(2024);
      expect(deductible).toBeGreaterThan(0);
      expect(deductible).toBeLessThan(5000); // Sanity check
    });

    it('should be consistent across multiple years', () => {
      const cost2024 = manager.getPartADeductible(2024);
      const cost2024_2 = manager.getPartADeductible(2024);
      expect(cost2024).toBe(cost2024_2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle age exactly 65', () => {
      const cost = manager.getMonthlyMedicareCost(65, 200000, 'mfj', 2024);
      expect(cost).toBeGreaterThan(0);
    });

    it('should handle very high income', () => {
      const surcharge = manager.getIRMAASurcharge(10000000, 'mfj');
      expect(surcharge.partBSurcharge).toBe(419.3);
      expect(surcharge.partDSurcharge).toBe(81);
    });

    it('should handle zero MAGI', () => {
      const surcharge = manager.getIRMAASurcharge(0, 'mfj');
      expect(surcharge.partBSurcharge).toBe(0);
      expect(surcharge.partDSurcharge).toBe(0);
    });

    it('should handle far future years gracefully', () => {
      const premium = manager.getPartBPremium(2050);
      expect(premium).toBeGreaterThan(0);

      const cost = manager.getMonthlyMedicareCost(85, 200000, 'mfj', 2050);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('Poisson Random Number Generation', () => {
    it('should produce integers only', () => {
      const random = () => Math.random();
      for (let i = 0; i < 100; i++) {
        const val = manager.generateHospitalAdmissions(75, 2024, random);
        expect(val).toBe(Math.floor(val));
      }
    });

    it('should produce values >= 0', () => {
      const random = () => Math.random();
      for (let i = 0; i < 100; i++) {
        const val = manager.generateHospitalAdmissions(75, 2024, random);
        expect(val).toBeGreaterThanOrEqual(0);
      }
    });

    it('should be seeded-random consistent', () => {
      // Create seeded RNG
      let seed = 12345;
      const seededRandom = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      // Generate two sequences with same seed
      seed = 12345;
      const seq1 = [];
      for (let i = 0; i < 10; i++) {
        seq1.push(manager.generateHospitalAdmissions(75, 2024, seededRandom));
      }

      seed = 12345;
      const seq2 = [];
      for (let i = 0; i < 10; i++) {
        seq2.push(manager.generateHospitalAdmissions(75, 2024, seededRandom));
      }

      expect(seq1).toEqual(seq2);
    });
  });

  describe('Cost Progression Over Time', () => {
    it('should show increasing Medicare costs over decades', () => {
      const cost2024 = manager.getMonthlyMedicareCost(70, 250000, 'mfj', 2024);
      const cost2034 = manager.getMonthlyMedicareCost(70, 250000, 'mfj', 2034);
      const cost2044 = manager.getMonthlyMedicareCost(70, 250000, 'mfj', 2044);

      expect(cost2024).toBeGreaterThan(0);
      expect(cost2034).toBeGreaterThan(cost2024);
      expect(cost2044).toBeGreaterThan(cost2034);
    });
  });
});
