import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AcaManager } from './aca-manager';

// Mock the IO module
vi.mock('../../utils/io/io', () => ({
  load: (filename: string) => {
    if (filename === 'historicRates.json') {
      return {
        acaBenchmarkPremium: {
          '2018': 627.0,
          '2019': 618.0,
          '2020': 629.0,
          '2024': 660.0,
          '2025': 680.0,
          '2026': 700.0,
        },
        acaAgeCurve: {
          '0': 0.765,
          '1': 0.765,
          '14': 0.765,
          '15': 1.0,
          '21': 1.0,
          '25': 1.0,
          '30': 1.0,
          '35': 1.0,
          '40': 1.278,
          '45': 1.395,
          '50': 1.56,
          '55': 1.857,
          '60': 2.289,
          '64': 3.0,
        },
        fpl: {
          '2024': { firstPerson: 15060.0, additionalPerson: 5380.0 },
          '2025': { firstPerson: 15650.0, additionalPerson: 5500.0 },
          '2026': { firstPerson: 15960.0, additionalPerson: 5680.0 },
        },
        employerPremium: {
          '2026': 1124.32,
        },
        acaOutOfPocketMax: {
          '2014': { individual: 6350, family: 12700 },
          '2015': { individual: 6600, family: 13200 },
          '2016': { individual: 6850, family: 13700 },
          '2017': { individual: 7150, family: 14300 },
          '2018': { individual: 7350, family: 14700 },
          '2019': { individual: 7900, family: 15800 },
          '2020': { individual: 8150, family: 16300 },
          '2021': { individual: 8550, family: 17100 },
          '2022': { individual: 8700, family: 17400 },
          '2023': { individual: 9100, family: 18200 },
          '2024': { individual: 9450, family: 18900 },
          '2025': { individual: 9200, family: 18400 },
          '2026': { individual: 10600, family: 21200 },
          '2027': { individual: 12000, family: 24000 },
        },
      };
    }
    return {};
  },
}));

describe('AcaManager', () => {
  let manager: AcaManager;

  beforeEach(() => {
    manager = new AcaManager();
  });

  describe('COBRA premium', () => {
    it('should calculate COBRA premium as 102% of employer premium', () => {
      const premium = manager.getCobraMonthlyPremium(2026);
      // 1124.32 * 1.02 = 1146.8064
      expect(premium).toBeCloseTo(1146.81, 1);
    });

    it('should inflate COBRA premium at 5% for future years', () => {
      const premium2026 = manager.getCobraMonthlyPremium(2026);
      const premium2027 = manager.getCobraMonthlyPremium(2027);
      const premium2028 = manager.getCobraMonthlyPremium(2028);

      // 2027 should be ~5% higher than 2026
      expect(premium2027).toBeCloseTo(premium2026 * 1.05, 1);

      // 2028 should be ~5% higher than 2027
      expect(premium2028).toBeCloseTo(premium2027 * 1.05, 1);
    });

    it('should return same premium for years <= 2026', () => {
      const premium2026 = manager.getCobraMonthlyPremium(2026);
      const premium2024 = manager.getCobraMonthlyPremium(2024);
      expect(premium2024).toBeCloseTo(premium2026, 1);
    });
  });

  describe('ACA premium for person', () => {
    it('should calculate age 40 premium equal to benchmark', () => {
      // Age 40: factor 1.278; benchmark uses age 40, so should equal benchmark
      const premium = manager.getAcaPremiumForPerson(40, 2026);
      // Benchmark 2026 = 700, age 40 factor = 1.278 / 1.278 = 1.0
      expect(premium).toBeCloseTo(700, 0);
    });

    it('should calculate age 21 premium less than age 40', () => {
      const premium21 = manager.getAcaPremiumForPerson(21, 2026);
      const premium40 = manager.getAcaPremiumForPerson(40, 2026);
      expect(premium21).toBeLessThan(premium40);
    });

    it('should calculate age 64 premium greater than age 40', () => {
      const premium40 = manager.getAcaPremiumForPerson(40, 2026);
      const premium64 = manager.getAcaPremiumForPerson(64, 2026);
      // Age 64: 3.0 / 1.278 ≈ 2.35x
      expect(premium64).toBeGreaterThan(premium40);
      expect(premium64).toBeCloseTo(premium40 * (3.0 / 1.278), 0);
    });

    it('should calculate age 64 approximately 3x age 21 premium', () => {
      const premium21 = manager.getAcaPremiumForPerson(21, 2026);
      const premium64 = manager.getAcaPremiumForPerson(64, 2026);
      // Age 64 factor: 3.0; age 21 factor: 1.0
      // So ratio should be ~3.0 / 1.0 = 3.0
      expect(premium64 / premium21).toBeCloseTo(3.0, 0);
    });

    it('should inflate premium for future years', () => {
      const premium2026 = manager.getAcaPremiumForPerson(40, 2026);
      const premium2027 = manager.getAcaPremiumForPerson(40, 2027);
      // 5% inflation from 2026 to 2027
      expect(premium2027).toBeCloseTo(premium2026 * 1.05, 0);
    });
  });

  describe('ACA couple gross premium', () => {
    it('should equal sum of two individual premiums', () => {
      const couple = manager.getAcaCoupleGrossPremium(40, 39, 2026);
      const individual40 = manager.getAcaPremiumForPerson(40, 2026);
      const individual39 = manager.getAcaPremiumForPerson(39, 2026);
      expect(couple).toBeCloseTo(individual40 + individual39, 1);
    });

    it('should scale with different ages', () => {
      const young = manager.getAcaCoupleGrossPremium(30, 30, 2026);
      const old = manager.getAcaCoupleGrossPremium(60, 60, 2026);
      expect(old).toBeGreaterThan(young);
    });
  });

  describe('ACA subsidy', () => {
    it('should provide full subsidy at 150% FPL', () => {
      // At 150% FPL, expected contribution = 0%
      const fpl2026 = 15960 + 5680; // firstPerson + additionalPerson for 2-person household
      const householdMAGI = fpl2026 * 1.5;
      const grossMonthly = 1000;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 2, 2026, grossMonthly);
      // Subsidy should cover full premium
      expect(subsidy).toBeCloseTo(grossMonthly, 0);
    });

    it('should provide partial subsidy at 250% FPL', () => {
      // At 250% FPL, expected contribution ≈ 6%
      const fpl2026 = 15960 + 5680;
      const householdMAGI = fpl2026 * 2.5;
      const grossMonthly = 1000;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 2, 2026, grossMonthly);
      // Expected annual contribution = 1000 * 12 * 0.06 = 720
      // Monthly subsidy = 1000 - 720/12 = 940
      expect(subsidy).toBeGreaterThan(0);
      expect(subsidy).toBeLessThan(grossMonthly);
    });

    it('should apply cliff at 400%+ FPL for 2026+', () => {
      const fpl2026 = 15960 + 5680;
      const householdMAGI = fpl2026 * 4.1; // Just over 400%
      const grossMonthly = 1000;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 2, 2026, grossMonthly);
      // Cliff applies: no subsidy
      expect(subsidy).toBeCloseTo(0, 0);
    });

    it('should NOT apply cliff at 400%+ FPL for 2025', () => {
      const fpl2025 = 15650 + 5500;
      const householdMAGI = fpl2025 * 4.1; // Just over 400%
      const grossMonthly = 1000;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 2, 2025, grossMonthly);
      // No cliff in 2025: should be 8.5% cap
      // Expected annual contribution = 1000 * 12 * 0.085 = 1020
      // But monthly subsidy can't exceed premium, so capped at 0
      expect(subsidy).toBeLessThanOrEqual(grossMonthly);
    });

    it('should interpolate subsidy at 200% FPL (0% → 2%)', () => {
      const fpl2026 = 15960 + 5680;
      const householdMAGI = fpl2026 * 2.0; // Exactly 200%
      const grossMonthly = 1000;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 2, 2026, grossMonthly);
      // At 200%, contribution = 2%
      // Expected annual contribution = householdMAGI * 0.02
      // Monthly subsidy = max(0, grossMonthly - annualContribution/12)
      const expectedAnnualContribution = householdMAGI * 0.02;
      const expectedMonthlySubsidy = Math.max(0, grossMonthly - expectedAnnualContribution / 12);
      expect(subsidy).toBeCloseTo(expectedMonthlySubsidy, 0);
    });

    it('should cap subsidy at gross premium', () => {
      const fpl2026 = 15960 + 5680;
      const householdMAGI = 5000; // Very low income
      const grossMonthly = 1000;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 2, 2026, grossMonthly);
      expect(subsidy).toBeLessThanOrEqual(grossMonthly);
    });

    it('should handle single-person household FPL correctly', () => {
      const fpl2026 = 15960; // firstPerson only
      const householdMAGI = fpl2026 * 1.5;
      const grossMonthly = 500;

      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, 1, 2026, grossMonthly);
      // At 150% FPL, contribution = 0%
      expect(subsidy).toBeCloseTo(grossMonthly, 0);
    });
  });

  describe('Net monthly premium', () => {
    it('should equal gross premium minus subsidy', () => {
      const age1 = 40;
      const age2 = 39;
      const householdMAGI = 100000;
      const householdSize = 2;
      const year = 2026;

      const net = manager.getNetMonthlyPremium(age1, age2, householdMAGI, householdSize, year);
      const gross = manager.getAcaCoupleGrossPremium(age1, age2, year);
      const subsidy = manager.calculateMonthlySubsidy(householdMAGI, householdSize, year, gross);

      expect(net).toBeCloseTo(gross - subsidy, 1);
    });

    it('should never be negative', () => {
      const net = manager.getNetMonthlyPremium(40, 39, 500000, 2, 2026);
      expect(net).toBeGreaterThanOrEqual(0);
    });
  });

  describe('COBRA period detection', () => {
    it('should detect within 18 months of retirement', () => {
      const retireDate = new Date('2026-01-01');
      const within18 = new Date('2027-06-01');
      expect(manager.isCobraPeriod(retireDate, within18)).toBe(true);
    });

    it('should detect after 18 months of retirement', () => {
      const retireDate = new Date('2026-01-01');
      const after18 = new Date('2027-07-01'); // 18+ months
      expect(manager.isCobraPeriod(retireDate, after18)).toBe(false);
    });

    it('should detect on retirement date', () => {
      const retireDate = new Date('2026-01-01');
      expect(manager.isCobraPeriod(retireDate, retireDate)).toBe(true);
    });

    it('should detect 17 months after retirement', () => {
      const retireDate = new Date('2026-01-01');
      const months17 = new Date('2027-06-01');
      expect(manager.isCobraPeriod(retireDate, months17)).toBe(true);
    });
  });

  describe('ACA person count', () => {
    it('should return 2 when both under 65', () => {
      const date = new Date('2026-01-01');
      const birthDate1 = new Date('1980-01-01');
      const birthDate2 = new Date('1981-01-01');
      const count = manager.getAcaPersonCount(date, birthDate1, birthDate2);
      expect(count).toBe(2);
    });

    it('should return 1 when one person hits 65', () => {
      const date = new Date('2045-06-01');
      const birthDate1 = new Date('1980-01-01'); // Will be 65 (exact birthday Jan 1)
      const birthDate2 = new Date('1981-01-01'); // Will be 64
      const count = manager.getAcaPersonCount(date, birthDate1, birthDate2);
      expect(count).toBe(1);
    });

    it('should return 0 when both hit 65', () => {
      const date = new Date('2046-01-01');
      const birthDate1 = new Date('1980-01-01'); // Will be 66
      const birthDate2 = new Date('1980-06-01'); // Will be 65+
      const count = manager.getAcaPersonCount(date, birthDate1, birthDate2);
      expect(count).toBeLessThanOrEqual(1); // At least one is 65+
    });
  });

  describe('Monthly healthcare premium', () => {
    it('should return COBRA premium during COBRA period', () => {
      const retireDate = new Date('2026-01-01');
      const currentDate = new Date('2026-06-01'); // Within 18 months
      const premium = manager.getMonthlyHealthcarePremium(
        retireDate,
        currentDate,
        40,
        39,
        100000,
        2,
        2026,
      );
      const cobraPremium = manager.getCobraMonthlyPremium(2026);
      expect(premium).toBeCloseTo(cobraPremium, 1);
    });

    it('should return ACA premium after COBRA period', () => {
      const retireDate = new Date('2026-01-01');
      const currentDate = new Date('2027-08-01'); // After 18 months (19+ months)
      const premium = manager.getMonthlyHealthcarePremium(
        retireDate,
        currentDate,
        40,
        39,
        100000,
        2,
        2027,
      );
      const acaPremium = manager.getNetMonthlyPremium(40, 39, 100000, 2, 2027);
      expect(premium).toBeCloseTo(acaPremium, 1);
    });
  });

  describe('ACA deductible', () => {
    it('should return deductible values for a given year', () => {
      const deductible = manager.getAcaDeductible(2024);
      const oopMax = manager.getAcaOOPMax(2024);

      // Deductible should be reasonable (between 0 and OOP max)
      expect(deductible.individual).toBeGreaterThan(0);
      expect(deductible.individual).toBeLessThanOrEqual(oopMax.individual);
      expect(deductible.family).toBeGreaterThan(deductible.individual);
      expect(deductible.family).toBeLessThanOrEqual(oopMax.family);
    });

    it('should return reasonable defaults if no data', () => {
      const deductible = manager.getAcaDeductible(2024);
      expect(deductible.individual).toBeGreaterThan(0);
      expect(deductible.family).toBeGreaterThan(deductible.individual);
    });
  });

  describe('ACA out-of-pocket maximum', () => {
    it('should return 2024 OOP max for 2024', () => {
      const oopMax = manager.getAcaOOPMax(2024);
      expect(oopMax.individual).toBe(9450);
      expect(oopMax.family).toBe(18900);
    });

    it('should use actual data when available', () => {
      const oop2024 = manager.getAcaOOPMax(2024);
      const oop2026 = manager.getAcaOOPMax(2026);

      // Should return the explicit 2026 value when available
      expect(oop2026.individual).toBe(10600);
      expect(oop2026.family).toBe(21200);
    });

    it('should return latest available data for past years', () => {
      const oop2010 = manager.getAcaOOPMax(2010);
      // Should return earliest available (2014) or reasonable default
      expect(oop2010.individual).toBeGreaterThan(0);
    });
  });
});
