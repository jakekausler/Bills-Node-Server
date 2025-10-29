import { describe, it, expect, beforeEach } from 'vitest';
import { HealthcareManager } from './healthcare-manager';
import { HealthcareConfig } from '../../data/healthcare/types';

describe('HealthcareManager', () => {
  let manager: HealthcareManager;
  const testConfig: HealthcareConfig = {
    id: 'test-1',
    name: 'Test Plan',
    personName: 'John',
    startDate: '2024-01-01',
    endDate: null,
    individualDeductible: 1500,
    individualOutOfPocketMax: 5000,
    familyDeductible: 3000,
    familyOutOfPocketMax: 10000,
    hsaAccountId: 'hsa-123',
    hsaReimbursementEnabled: true,
    resetMonth: 0,
    resetDay: 1,
  };

  beforeEach(() => {
    manager = new HealthcareManager([testConfig]);
  });

  describe('constructor', () => {
    it('should initialize with configs', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('getActiveConfig', () => {
    it('should return config for matching person and date', () => {
      const date = new Date('2024-06-15');
      const config = manager.getActiveConfig('John', date);
      expect(config).toBeDefined();
      expect(config?.personName).toBe('John');
    });

    it('should return null for non-matching person', () => {
      const date = new Date('2024-06-15');
      const config = manager.getActiveConfig('Jane', date);
      expect(config).toBeNull();
    });

    it('should return null for date before config start', () => {
      const date = new Date('2023-12-31');
      const config = manager.getActiveConfig('John', date);
      expect(config).toBeNull();
    });

    it('should return null for date after config end', () => {
      const configWithEnd: HealthcareConfig = {
        ...testConfig,
        id: 'test-2',
        endDate: '2024-06-30',
      };
      const managerWithEnd = new HealthcareManager([configWithEnd]);

      const date = new Date('2024-07-01');
      const config = managerWithEnd.getActiveConfig('John', date);
      expect(config).toBeNull();
    });

    it('should return most recent config when multiple match', () => {
      const oldConfig: HealthcareConfig = {
        ...testConfig,
        id: 'old-config',
        name: 'Old Plan',
        startDate: '2023-01-01',
        endDate: '2024-06-30',
      };
      const newConfig: HealthcareConfig = {
        ...testConfig,
        id: 'new-config',
        name: 'New Plan',
        startDate: '2024-07-01',
        endDate: null,
      };
      const managerMultiple = new HealthcareManager([oldConfig, newConfig]);

      const date = new Date('2024-08-15');
      const config = managerMultiple.getActiveConfig('John', date);
      expect(config?.name).toBe('New Plan');
    });
  });

  describe('getPlanYear', () => {
    it('should return current year for date after reset date', () => {
      const date = new Date('2024-06-15'); // After Jan 1 reset
      const planYear = manager['getPlanYear'](testConfig, date);
      expect(planYear).toBe(2024);
    });

    it('should return previous year for date before reset date', () => {
      const midYearConfig: HealthcareConfig = {
        ...testConfig,
        resetMonth: 6, // July
        resetDay: 1,
      };
      const managerMidYear = new HealthcareManager([midYearConfig]);

      const date = new Date('2024-03-15'); // Before July 1 reset
      const planYear = managerMidYear['getPlanYear'](midYearConfig, date);
      expect(planYear).toBe(2023);
    });

    it('should return current year for date on reset date', () => {
      const date = new Date('2024-01-01'); // Exactly on Jan 1 reset
      const planYear = manager['getPlanYear'](testConfig, date);
      expect(planYear).toBe(2024);
    });
  });
});
