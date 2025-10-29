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

  describe('getOrCreateTracker', () => {
    it('should create tracker on first access', () => {
      const date = new Date('2024-06-15');
      const tracker = manager['getOrCreateTracker'](testConfig, date);

      expect(tracker).toBeDefined();
      expect(tracker.planYear).toBe(2024);
      expect(tracker.familyDeductible).toBe(0);
      expect(tracker.familyOOP).toBe(0);
    });

    it('should return same tracker on subsequent access', () => {
      const date = new Date('2024-06-15');
      const tracker1 = manager['getOrCreateTracker'](testConfig, date);
      const tracker2 = manager['getOrCreateTracker'](testConfig, date);

      expect(tracker1).toBe(tracker2);
    });
  });

  describe('resetIfNeeded', () => {
    it('should not reset tracking within same plan year', () => {
      const date1 = new Date('2024-06-15');
      manager['resetIfNeeded'](testConfig, date1);
      const tracker = manager['getOrCreateTracker'](testConfig, date1);

      // Add some tracking data
      tracker.individualDeductible.set('John', 500);
      tracker.familyDeductible = 500;

      const date2 = new Date('2024-08-15');
      manager['resetIfNeeded'](testConfig, date2);

      expect(tracker.individualDeductible.get('John')).toBe(500);
      expect(tracker.familyDeductible).toBe(500);
    });

    it('should reset tracking when crossing plan year boundary', () => {
      const midYearConfig: HealthcareConfig = {
        ...testConfig,
        resetMonth: 6, // July
        resetDay: 1,
      };
      const managerMidYear = new HealthcareManager([midYearConfig]);

      const date1 = new Date('2024-06-15'); // Plan year 2023
      managerMidYear['resetIfNeeded'](midYearConfig, date1);
      const tracker = managerMidYear['getOrCreateTracker'](midYearConfig, date1);

      // Add some tracking data
      tracker.individualDeductible.set('John', 500);
      tracker.familyDeductible = 500;

      const date2 = new Date('2024-07-15'); // Plan year 2024
      managerMidYear['resetIfNeeded'](midYearConfig, date2);

      expect(tracker.individualDeductible.get('John')).toBeUndefined();
      expect(tracker.familyDeductible).toBe(0);
      expect(tracker.planYear).toBe(2024);
    });
  });

  describe('recordHealthcareExpense', () => {
    it('should record individual and family deductible', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 200, 200, testConfig);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(200);
      expect(tracker.familyDeductible).toBe(200);
    });

    it('should accumulate expenses over multiple calls', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 100, 100, testConfig);
      manager.recordHealthcareExpense('John', date, 200, 200, testConfig);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(300);
      expect(tracker.familyDeductible).toBe(300);
    });

    it('should track multiple family members separately', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 100, 100, testConfig);
      manager.recordHealthcareExpense('Jane', date, 200, 200, testConfig);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(100);
      expect(tracker.individualDeductible.get('Jane')).toBe(200);
      expect(tracker.familyDeductible).toBe(300);
    });

    it('should track OOP separately from deductible', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 100, 50, testConfig);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(100);
      expect(tracker.individualOOP.get('John')).toBe(50);
      expect(tracker.familyDeductible).toBe(100);
      expect(tracker.familyOOP).toBe(50);
    });
  });

  describe('getDeductibleProgress', () => {
    it('should return false when no expenses recorded', () => {
      const date = new Date('2024-06-15');
      const progress = manager.getDeductibleProgress(testConfig, date, 'John');

      expect(progress.individualMet).toBe(false);
      expect(progress.familyMet).toBe(false);
      expect(progress.individualRemaining).toBe(1500);
      expect(progress.familyRemaining).toBe(3000);
    });

    it('should return true when individual deductible met', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 1500, 1500, testConfig);

      const progress = manager.getDeductibleProgress(testConfig, date, 'John');
      expect(progress.individualMet).toBe(true);
      expect(progress.familyMet).toBe(false);
    });

    it('should return true when family deductible met', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 1500, 1500, testConfig);
      manager.recordHealthcareExpense('Jane', date, 1500, 1500, testConfig);

      const progress = manager.getDeductibleProgress(testConfig, date, 'John');
      expect(progress.individualMet).toBe(true);
      expect(progress.familyMet).toBe(true);
    });

    it('should calculate remaining amounts correctly', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 500, 500, testConfig);

      const progress = manager.getDeductibleProgress(testConfig, date, 'John');
      expect(progress.individualRemaining).toBe(1000);
      expect(progress.familyRemaining).toBe(2500);
    });
  });

  describe('getOOPProgress', () => {
    it('should return false when no expenses recorded', () => {
      const date = new Date('2024-06-15');
      const progress = manager.getOOPProgress(testConfig, date, 'John');

      expect(progress.individualMet).toBe(false);
      expect(progress.familyMet).toBe(false);
      expect(progress.individualRemaining).toBe(5000);
      expect(progress.familyRemaining).toBe(10000);
    });

    it('should return true when individual OOP met', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 0, 5000, testConfig);

      const progress = manager.getOOPProgress(testConfig, date, 'John');
      expect(progress.individualMet).toBe(true);
      expect(progress.familyMet).toBe(false);
    });

    it('should return true when family OOP met', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 0, 5000, testConfig);
      manager.recordHealthcareExpense('Jane', date, 0, 5000, testConfig);

      const progress = manager.getOOPProgress(testConfig, date, 'John');
      expect(progress.individualMet).toBe(true);
      expect(progress.familyMet).toBe(true);
    });
  });
});
