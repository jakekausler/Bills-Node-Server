import { describe, it, expect } from 'vitest';
import { AcaManager } from './aca-manager';
import { MortalityManager } from './mortality-manager';
import { HealthcareManager } from './healthcare-manager';
import type { HealthcareConfig } from '../../data/healthcare/types';

describe('Death-Triggered COBRA for Surviving Spouse', () => {
  describe('HealthcareConfig fields', () => {
    it('should accept policyholder field', () => {
      const config: HealthcareConfig = {
        id: 'health-1',
        name: 'Health Insurance',
        coveredPersons: ['Jake', 'Jane'],
        policyholder: 'Jake',
        startDate: '2026-01-01',
        endDate: '2050-12-31',
        individualDeductible: 2500,
        individualOutOfPocketMax: 5000,
        familyDeductible: 5000,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };
      expect(config.policyholder).toBe('Jake');
    });

    it('should accept monthlyPremium field', () => {
      const config: HealthcareConfig = {
        id: 'health-1',
        name: 'Health Insurance',
        coveredPersons: ['Jake', 'Jane'],
        policyholder: 'Jake',
        monthlyPremium: 1124,
        monthlyPremiumInflationVariable: 'HEALTHCARE_INFLATION',
        startDate: '2026-01-01',
        endDate: '2050-12-31',
        individualDeductible: 2500,
        individualOutOfPocketMax: 5000,
        familyDeductible: 5000,
        familyOutOfPocketMax: 10000,
        hsaAccountId: null,
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };
      expect(config.monthlyPremium).toBe(1124);
      expect(config.monthlyPremiumInflationVariable).toBe('HEALTHCARE_INFLATION');
    });
  });

  describe('COBRA premium calculation', () => {
    it('should use plan-level monthlyPremium for COBRA calculation', () => {
      const acaManager = new AcaManager();
      const cobraPremium2026 = acaManager.getCobraMonthlyPremium(2026, 1124);
      expect(cobraPremium2026).toBe(1124 * 1.02); // 1.02x markup
    });

    it('should fall back to historicRates when no override provided', () => {
      const acaManager = new AcaManager();
      const cobraPremium = acaManager.getCobraMonthlyPremium(2026);
      // Should use historicRates.employerPremium[2026] = 1124.32
      expect(cobraPremium).toBeGreaterThan(0);
    });

    it('should inflate COBRA premium by healthcare CPI for future years', () => {
      const acaManager = new AcaManager();
      const basePremium = 1124;
      const cobraPremium2026 = acaManager.getCobraMonthlyPremium(2026, basePremium);
      const cobraPremium2027 = acaManager.getCobraMonthlyPremium(2027, basePremium);
      // 2027 should be higher due to 5% healthcare inflation
      expect(cobraPremium2027).toBeGreaterThan(cobraPremium2026);
    });
  });

  describe('Death COBRA tracking in MortalityManager', () => {
    it('should track death COBRA months elapsed', () => {
      const manager = new MortalityManager();
      expect(manager.getDeathCobraMonthsElapsed('Jake')).toBe(0);

      manager.incrementDeathCobraMonth('Jake');
      expect(manager.getDeathCobraMonthsElapsed('Jake')).toBe(1);

      for (let i = 0; i < 35; i++) {
        manager.incrementDeathCobraMonth('Jake');
      }
      expect(manager.getDeathCobraMonthsElapsed('Jake')).toBe(36);
    });

    it('should track last death COBRA month (0-11)', () => {
      const manager = new MortalityManager();
      expect(manager.getLastDeathCobraMonth('Jake')).toBeNull();

      manager.setLastDeathCobraMonth('Jake', 5);
      expect(manager.getLastDeathCobraMonth('Jake')).toBe(5);
    });

    it('should identify when in death COBRA period (< 36 months)', () => {
      const manager = new MortalityManager();
      // Not deceased - isInDeathCobra should be false
      expect(manager.isInDeathCobra('Jake')).toBe(false);
    });
  });

  describe('isCobraPeriod with death date', () => {
    it('should detect death-triggered COBRA (36 months)', () => {
      const acaManager = new AcaManager();
      const retirementDate = new Date('2030-01-01');
      const deathDate = new Date('2030-06-01');
      const checkDate = new Date('2032-06-01'); // 24 months after death

      const isCobraPeriod = acaManager.isCobraPeriod(retirementDate, checkDate, deathDate);
      expect(isCobraPeriod).toBe(true);
    });

    it('should end death COBRA after 36 months', () => {
      const acaManager = new AcaManager();
      const retirementDate = new Date('2030-01-01');
      const deathDate = new Date('2030-06-01');
      const checkDate = new Date('2033-06-02'); // 36+ months after death

      const isCobraPeriod = acaManager.isCobraPeriod(retirementDate, checkDate, deathDate);
      expect(isCobraPeriod).toBe(false);
    });

    it('should prefer death COBRA (36mo) over retirement COBRA (18mo)', () => {
      const acaManager = new AcaManager();
      const retirementDate = new Date('2030-01-01');
      const deathDate = new Date('2030-12-01');
      const checkDate = new Date('2031-07-15'); // ~19 months after retirement, 7 months after death

      // Without death date, should have exited COBRA (18mo after retirement)
      expect(acaManager.isCobraPeriod(retirementDate, checkDate)).toBe(false);

      // With death date, should still be in COBRA (< 36mo after death)
      expect(acaManager.isCobraPeriod(retirementDate, checkDate, deathDate)).toBe(true);
    });
  });

  describe('HealthcareManager', () => {
    it('should provide getAllConfigs method', () => {
      const configs: HealthcareConfig[] = [
        {
          id: 'health-1',
          name: 'Health Insurance',
          coveredPersons: ['Jake'],
          policyholder: 'Jake',
          startDate: '2026-01-01',
          endDate: '2050-12-31',
          individualDeductible: 2500,
          individualOutOfPocketMax: 5000,
          familyDeductible: 5000,
          familyOutOfPocketMax: 10000,
          hsaAccountId: null,
          hsaReimbursementEnabled: false,
          resetMonth: 0,
          resetDay: 1,
        },
      ];
      const manager = new HealthcareManager(configs);
      const allConfigs = manager.getAllConfigs();
      expect(allConfigs).toHaveLength(1);
      expect(allConfigs[0].policyholder).toBe('Jake');
    });
  });
});
