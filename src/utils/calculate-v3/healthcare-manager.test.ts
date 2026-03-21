import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthcareManager } from './healthcare-manager';
import { HealthcareConfig } from '../../data/healthcare/types';
import type { MortalityManager } from './mortality-manager';

describe('HealthcareManager', () => {
  let manager: HealthcareManager;
  const testConfig: HealthcareConfig = {
    id: 'test-1',
    name: 'Test Plan',
    coveredPersons: ['John'],
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
      expect(config?.coveredPersons).toContain('John');
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
      const date = new Date(2024, 0, 1); // Exactly on Jan 1 reset (local time)
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

      // Verify family total is calculated correctly via getDeductibleProgress
      const progress = manager.getDeductibleProgress(testConfig, date, 'John');
      expect(progress.individualRemaining).toBe(1300); // 1500 - 200
      expect(progress.familyRemaining).toBe(2800); // 3000 - 200
    });

    it('should accumulate expenses over multiple calls', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 100, 100, testConfig);
      manager.recordHealthcareExpense('John', date, 200, 200, testConfig);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(300);

      // Verify family total is calculated correctly
      const progress = manager.getDeductibleProgress(testConfig, date, 'John');
      expect(progress.familyRemaining).toBe(2700); // 3000 - 300
    });

    it('should track multiple family members separately', () => {
      const familyConfig: HealthcareConfig = {
        ...testConfig,
        coveredPersons: ['John', 'Jane'],
      };
      const familyManager = new HealthcareManager([familyConfig]);

      const date = new Date('2024-06-15');
      familyManager.recordHealthcareExpense('John', date, 100, 100, familyConfig);
      familyManager.recordHealthcareExpense('Jane', date, 200, 200, familyConfig);

      const tracker = familyManager['getOrCreateTracker'](familyConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(100);
      expect(tracker.individualDeductible.get('Jane')).toBe(200);

      // Verify family total is calculated correctly as sum of both members
      const progress = familyManager.getDeductibleProgress(familyConfig, date, 'John');
      expect(progress.familyRemaining).toBe(2700); // 3000 - (100 + 200)
    });

    it('should track OOP separately from deductible', () => {
      const date = new Date('2024-06-15');
      manager.recordHealthcareExpense('John', date, 100, 50, testConfig);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(100);
      expect(tracker.individualOOP.get('John')).toBe(50);

      // Verify totals are calculated correctly via progress methods
      const deductibleProgress = manager.getDeductibleProgress(testConfig, date, 'John');
      const oopProgress = manager.getOOPProgress(testConfig, date, 'John');
      expect(deductibleProgress.familyRemaining).toBe(2900); // 3000 - 100
      expect(oopProgress.familyRemaining).toBe(9950); // 10000 - 50
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
      const familyConfig: HealthcareConfig = {
        ...testConfig,
        coveredPersons: ['John', 'Jane'],
      };
      const familyManager = new HealthcareManager([familyConfig]);

      const date = new Date('2024-06-15');
      familyManager.recordHealthcareExpense('John', date, 1500, 1500, familyConfig);
      familyManager.recordHealthcareExpense('Jane', date, 1500, 1500, familyConfig);

      const progress = familyManager.getDeductibleProgress(familyConfig, date, 'John');
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
      const familyConfig: HealthcareConfig = {
        ...testConfig,
        coveredPersons: ['John', 'Jane'],
      };
      const familyManager = new HealthcareManager([familyConfig]);

      const date = new Date('2024-06-15');
      familyManager.recordHealthcareExpense('John', date, 0, 5000, familyConfig);
      familyManager.recordHealthcareExpense('Jane', date, 0, 5000, familyConfig);

      const progress = familyManager.getOOPProgress(familyConfig, date, 'John');
      expect(progress.individualMet).toBe(true);
      expect(progress.familyMet).toBe(true);
    });
  });

  describe('calculateCopayBasedCost', () => {
    it('should return copay amount', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: 25,
        coinsurancePercent: null,
        countsTowardDeductible: false,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager['calculateCopayBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      expect(cost).toBe(25);
    });

    it('should track toward OOP when configured', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: 25,
        coinsurancePercent: null,
        countsTowardDeductible: false,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      manager['calculateCopayBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualOOP.get('John')).toBe(25);
      expect(tracker.individualDeductible.get('John')).toBeUndefined();
    });

    it('should track toward deductible when configured', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: 25,
        coinsurancePercent: null,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      manager['calculateCopayBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(200);
      expect(tracker.individualOOP.get('John')).toBe(25);
    });
  });

  describe('calculateDeductibleBasedCost', () => {
    it('should charge 100% before deductible met', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      expect(cost).toBe(200);
    });

    it('should charge coinsurance % after deductible met', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      // Meet deductible first
      manager.recordHealthcareExpense('John', date, 1500, 1500, testConfig);

      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      expect(cost).toBe(40); // 20% of 200
    });

    it('should charge 0% after OOP max met', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      // Meet both deductible and OOP
      manager.recordHealthcareExpense('John', date, 1500, 5000, testConfig);

      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      expect(cost).toBe(0);
    });

    it('should use family deductible when met before individual', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'Jane',
      };

      const date = new Date('2024-06-15');
      // Meet family deductible but not Jane's individual
      manager.recordHealthcareExpense('John', date, 1500, 1500, testConfig);
      manager.recordHealthcareExpense('Jane', date, 1500, 1500, testConfig);

      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 200, 'Jane', date);

      expect(cost).toBe(40); // 20% coinsurance after family deductible met
    });

    it('should split cost when bill exceeds remaining deductible (Issue #19)', () => {
      // Scenario: $1500 deductible, $0 spent so far, $2000 bill with 30% coinsurance
      // Expected: Patient pays $1500 (to deductible) + $150 (30% of remaining $500) = $1650
      const janeConfig: HealthcareConfig = {
        ...testConfig,
        id: 'jane-test-config',
        coveredPersons: ['Jane'],
        startDate: '2024-01-01',
        individualDeductible: 1500,
        familyDeductible: 3000,
        coinsurancePercent: 30,
      };
      const managerJane = new HealthcareManager([janeConfig]);

      const mockExpense = {
        amount: 2000,
        copayAmount: null,
        coinsurancePercent: 30,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'Jane',
      };

      const date = new Date('2024-01-31'); // Use start year to avoid inflation
      const cost = managerJane['calculateDeductibleBasedCost'](
        mockExpense as any,
        janeConfig,
        2000,
        'Jane',
        date,
      );

      // Patient should pay: $1500 (remaining deductible) + $150 (30% of $500 after deductible) = $1650
      expect(cost).toBe(1650);

      // Verify tracking: deductible should show $1500 (capped at deductible limit)
      const tracker = managerJane['getOrCreateTracker'](janeConfig, date);
      expect(tracker.individualDeductible.get('Jane')).toBe(1500);

      // OOP should show full patient cost of $1650
      expect(tracker.individualOOP.get('Jane')).toBe(1650);
    });

    it('should handle bill exactly equal to remaining deductible', () => {
      const mockExpense = {
        amount: 1500,
        copayAmount: null,
        coinsurancePercent: 30,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 1500, 'John', date);

      // Bill exactly matches deductible - patient pays 100% of bill
      expect(cost).toBe(1500);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(1500);
      expect(tracker.individualOOP.get('John')).toBe(1500);
    });

    it('should handle bill less than remaining deductible', () => {
      const mockExpense = {
        amount: 500,
        copayAmount: null,
        coinsurancePercent: 30,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 500, 'John', date);

      // Bill is less than deductible - patient pays 100% of bill
      expect(cost).toBe(500);

      const tracker = manager['getOrCreateTracker'](testConfig, date);
      expect(tracker.individualDeductible.get('John')).toBe(500);
      expect(tracker.individualOOP.get('John')).toBe(500);
    });
  });

  describe('calculatePatientCost', () => {
    it('should use copay logic when copay is set', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: 25,
        coinsurancePercent: 20,
        countsTowardDeductible: false,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager.calculatePatientCost(mockExpense as any, testConfig, date);

      expect(cost).toBe(25);
    });

    it('should use deductible logic when copay is null', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager.calculatePatientCost(mockExpense as any, testConfig, date);

      expect(cost).toBe(200); // 100% before deductible
    });

    it('should use deductible logic when copay is 0 (Issue #22)', () => {
      // Bug: When copay is $0 with coinsurance, system should use deductible logic
      // not copay logic. $0 copay means "no copay", not "copay-based with $0"
      const mockExpense = {
        amount: 3000,
        copayAmount: 0, // Zero copay (common in high-deductible plans)
        coinsurancePercent: 100, // 100% coinsurance before deductible
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      const cost = manager.calculatePatientCost(mockExpense as any, testConfig, date);

      // Should charge 100% of bill before deductible (not $0!)
      expect(cost).toBe(3000);
    });

    it('should reset tracking before calculating if crossing plan year', () => {
      const midYearConfig: HealthcareConfig = {
        ...testConfig,
        resetMonth: 6, // July
        resetDay: 1,
      };
      const managerMidYear = new HealthcareManager([midYearConfig]);

      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      // Record expense in plan year 2023
      const date1 = new Date('2024-06-15');
      managerMidYear.recordHealthcareExpense('John', date1, 1500, 1500, midYearConfig);

      // Calculate in plan year 2024 (after reset)
      const date2 = new Date('2024-07-15');
      const cost = managerMidYear.calculatePatientCost(mockExpense as any, midYearConfig, date2);

      // Should charge 100% because deductible was reset
      expect(cost).toBe(200);
    });

    it('returns cached result when same expense is calculated twice on the same date', () => {
      const mockExpense = {
        id: 'expense-abc-123',
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');

      // First call calculates the actual cost
      const cost1 = manager.calculatePatientCost(mockExpense as any, testConfig, date);
      expect(cost1).toBe(200); // Before deductible: 100%

      // Second call on same expense+date should return cached result
      // (even if we mutate expense.amount, the cached result is used)
      const mutatedExpense = { ...mockExpense, amount: 9999 };
      const cost2 = manager.calculatePatientCost(mutatedExpense as any, testConfig, date);

      // Should return original cached value, not recalculate
      expect(cost2).toBe(200);
    });
  });

  describe('calculateDeductibleBasedCost - OOP tracking edge cases', () => {
    it('does not track toward OOP when countsTowardOutOfPocket is false (after deductible)', () => {
      const mockExpense = {
        amount: 200,
        copayAmount: null,
        coinsurancePercent: 20,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: false, // NOT tracking toward OOP
        healthcarePerson: 'John',
      };

      const date = new Date('2024-06-15');
      // Meet deductible first
      manager.recordHealthcareExpense('John', date, 1500, 1500, testConfig);

      // After deductible, coinsurance applies; OOP not counted
      const cost = manager['calculateDeductibleBasedCost'](mockExpense as any, testConfig, 200, 'John', date);

      // Should charge 20% coinsurance
      expect(cost).toBe(40);

      // OOP should not increase beyond the initial recorded 1500
      const oopProgress = manager.getOOPProgress(testConfig, date, 'John');
      expect(oopProgress.individualRemaining).toBe(3500); // 5000 - 1500 (OOP not incremented by this call)
    });
  });

  describe('Deductible/OOP inflation (#13 Phase 5)', () => {
    it('should inflate individual deductible by default 5% per year', () => {
      const configWithInflation: HealthcareConfig = {
        ...testConfig,
        id: 'test-inflation',
        startDate: '2024-01-01',
        individualDeductible: 1000,
      };
      const managerInflation = new HealthcareManager([configWithInflation]);

      // Year 0 (2024): should return base value
      const date2024 = new Date('2024-06-15');
      const progress2024 = managerInflation.getDeductibleProgress(configWithInflation, date2024, 'John');
      expect(progress2024.individualRemaining).toBe(1000);

      // Year 1 (2025): should inflate by 5% → 1050
      const date2025 = new Date('2025-06-15');
      const progress2025 = managerInflation.getDeductibleProgress(configWithInflation, date2025, 'John');
      expect(progress2025.individualRemaining).toBe(1050);

      // Year 2 (2026): should inflate by 5% compounded → 1102.5 ≈ 1103 (rounded)
      const date2026 = new Date('2026-06-15');
      const progress2026 = managerInflation.getDeductibleProgress(configWithInflation, date2026, 'John');
      expect(progress2026.individualRemaining).toBe(1103);
    });

    it('should use custom deductible inflation rate when specified', () => {
      const configCustomRate: HealthcareConfig = {
        ...testConfig,
        id: 'test-custom-rate',
        startDate: '2024-01-01',
        individualDeductible: 1000,
        deductibleInflationRate: 0.10, // 10% custom rate
      };
      const managerCustom = new HealthcareManager([configCustomRate]);

      // Year 1 (2025): should inflate by 10% → 1100
      const date2025 = new Date('2025-06-15');
      const progress2025 = managerCustom.getDeductibleProgress(configCustomRate, date2025, 'John');
      expect(progress2025.individualRemaining).toBe(1100);
    });

    it('should inflate family deductible by default 5% per year', () => {
      const configWithInflation: HealthcareConfig = {
        ...testConfig,
        id: 'test-family-inflation',
        startDate: '2024-01-01',
        familyDeductible: 2000,
      };
      const managerInflation = new HealthcareManager([configWithInflation]);

      // Year 0 (2024): should return base value
      const date2024 = new Date('2024-06-15');
      const progress2024 = managerInflation.getDeductibleProgress(configWithInflation, date2024, 'John');
      expect(progress2024.familyRemaining).toBe(2000);

      // Year 1 (2025): should inflate by 5% → 2100
      const date2025 = new Date('2025-06-15');
      const progress2025 = managerInflation.getDeductibleProgress(configWithInflation, date2025, 'John');
      expect(progress2025.familyRemaining).toBe(2100);
    });

    it('should inflate individual OOP max by default 5% per year', () => {
      const configWithInflation: HealthcareConfig = {
        ...testConfig,
        id: 'test-oop-inflation',
        startDate: '2024-01-01',
        individualOutOfPocketMax: 5000,
      };
      const managerInflation = new HealthcareManager([configWithInflation]);

      // Year 0 (2024): should return base value
      const date2024 = new Date('2024-06-15');
      const progress2024 = managerInflation.getOOPProgress(configWithInflation, date2024, 'John');
      expect(progress2024.individualRemaining).toBe(5000);

      // Year 1 (2025): should inflate by 5% → 5250
      const date2025 = new Date('2025-06-15');
      const progress2025 = managerInflation.getOOPProgress(configWithInflation, date2025, 'John');
      expect(progress2025.individualRemaining).toBe(5250);
    });

    it('should inflate family OOP max by default 5% per year', () => {
      const configWithInflation: HealthcareConfig = {
        ...testConfig,
        id: 'test-family-oop-inflation',
        startDate: '2024-01-01',
        familyOutOfPocketMax: 10000,
      };
      const managerInflation = new HealthcareManager([configWithInflation]);

      // Year 0 (2024): should return base value
      const date2024 = new Date('2024-06-15');
      const progress2024 = managerInflation.getOOPProgress(configWithInflation, date2024, 'John');
      expect(progress2024.familyRemaining).toBe(10000);

      // Year 1 (2025): should inflate by 5% → 10500
      const date2025 = new Date('2025-06-15');
      const progress2025 = managerInflation.getOOPProgress(configWithInflation, date2025, 'John');
      expect(progress2025.familyRemaining).toBe(10500);
    });

    it('should return base values when no inflation rate specified (default 5%)', () => {
      const configNoRate: HealthcareConfig = {
        ...testConfig,
        id: 'test-no-rate',
        startDate: '2024-01-01',
        individualDeductible: 1000,
        // No deductibleInflationRate specified, should use default 5%
      };
      const managerNoRate = new HealthcareManager([configNoRate]);

      // Year 1: should still apply 5% default
      const date2025 = new Date('2025-06-15');
      const progress2025 = managerNoRate.getDeductibleProgress(configNoRate, date2025, 'John');
      expect(progress2025.individualRemaining).toBe(1050); // 5% of 1000 = 1050
    });

    it('should handle year 0 (start year) correctly', () => {
      const configWithInflation: HealthcareConfig = {
        ...testConfig,
        id: 'test-year-0',
        startDate: '2024-01-01',
        individualDeductible: 1500,
      };
      const managerInflation = new HealthcareManager([configWithInflation]);

      // Date in start year should have zero years of inflation
      const dateStartYear = new Date('2024-01-15');
      const progressStart = managerInflation.getDeductibleProgress(configWithInflation, dateStartYear, 'John');
      expect(progressStart.individualRemaining).toBe(1500); // No inflation yet

      // Late in start year should still be year 0
      const dateEndYear = new Date('2024-12-15');
      const progressEnd = managerInflation.getDeductibleProgress(configWithInflation, dateEndYear, 'John');
      expect(progressEnd.individualRemaining).toBe(1500); // Still no inflation
    });
  });

  describe('family-to-individual coverage transition', () => {
    let familyConfig: HealthcareConfig;
    let mockMortalityManager: Partial<MortalityManager>;

    beforeEach(() => {
      familyConfig = {
        id: 'family-plan',
        name: 'Family Plan',
        coveredPersons: ['Jake', 'Kendall'],
        startDate: '2024-01-01',
        endDate: null,
        individualDeductible: 2500,
        individualOutOfPocketMax: 5000,
        familyDeductible: 5000,
        familyOutOfPocketMax: 10000,
        hsaAccountId: 'hsa-123',
        hsaReimbursementEnabled: false,
        resetMonth: 0,
        resetDay: 1,
      };

      mockMortalityManager = {
        getAlivePeople: vi.fn(),
      };
    });

    it('should use family deductible when both people are alive', () => {
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake', 'Kendall']);

      const manager = new HealthcareManager([familyConfig]);
      manager.setMortalityManager(mockMortalityManager as MortalityManager);

      const date = new Date('2024-06-15');

      // Both alive, so family deductible applies
      const progress = manager.getDeductibleProgress(familyConfig, date, 'Jake');

      // familyMet should be based on family deductible
      expect(progress.familyRemaining).toBe(5000);
      expect(progress.individualRemaining).toBe(2500);
    });

    it('should switch to individual deductible when one person dies', () => {
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake']);

      const manager = new HealthcareManager([familyConfig]);
      manager.setMortalityManager(mockMortalityManager as MortalityManager);

      const date = new Date('2024-06-15');

      // One alive, so individual deductible applies
      const progress = manager.getDeductibleProgress(familyConfig, date, 'Jake');

      // When in individual mode, familyMet should be treated as true (ignored)
      expect(progress.familyMet).toBe(true);
      expect(progress.individualRemaining).toBe(2500);
    });

    it('should use individual OOP max when one person dies', () => {
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake']);

      const manager = new HealthcareManager([familyConfig]);
      manager.setMortalityManager(mockMortalityManager as MortalityManager);

      const date = new Date('2024-06-15');

      // One alive, so individual OOP applies
      const progress = manager.getOOPProgress(familyConfig, date, 'Jake');

      // When in individual mode, familyMet should be treated as true (ignored)
      expect(progress.familyMet).toBe(true);
      expect(progress.individualRemaining).toBe(5000);
    });

    it('should track deductible correctly through family→individual transition', () => {
      const manager = new HealthcareManager([familyConfig]);
      manager.setMortalityManager(mockMortalityManager as MortalityManager);

      const date = new Date('2024-06-15');

      // Start with both alive
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake', 'Kendall']);

      // Record expense manually with both alive
      manager['recordHealthcareExpense']('Jake', date, 1000, 0, familyConfig);
      let progress = manager.getDeductibleProgress(familyConfig, date, 'Jake');

      // Should count toward family deductible (5000 - 1000 = 4000)
      expect(progress.familyRemaining).toBe(4000);

      // Now simulate death - one person alive
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake']);

      // Record another expense with only one alive
      manager['recordHealthcareExpense']('Jake', date, 1500, 0, familyConfig);
      progress = manager.getDeductibleProgress(familyConfig, date, 'Jake');

      // In individual mode, should use individual deductible
      // Individual: 2500 - 1000 - 1500 = 0
      expect(progress.individualRemaining).toBe(0);
      // Family deductible is ignored in individual mode
      expect(progress.familyMet).toBe(true);
    });

    it('should handle OOP transition from family to individual', () => {
      const manager = new HealthcareManager([familyConfig]);
      manager.setMortalityManager(mockMortalityManager as MortalityManager);

      const date = new Date('2024-06-15');

      // Start with both alive
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake', 'Kendall']);

      // Record OOP expense with both alive: 1000 OOP
      manager['recordHealthcareExpense']('Jake', date, 0, 1000, familyConfig);
      let progress = manager.getOOPProgress(familyConfig, date, 'Jake');

      // Family OOP should be reduced
      expect(progress.familyRemaining).toBe(9000); // 10000 - 1000

      // Now one person alive
      (mockMortalityManager.getAlivePeople as any).mockReturnValue(['Jake']);

      // Record another OOP expense with only one alive: another 1000 OOP
      manager['recordHealthcareExpense']('Jake', date, 0, 1000, familyConfig);
      progress = manager.getOOPProgress(familyConfig, date, 'Jake');

      // In individual mode, family limit is ignored
      expect(progress.familyMet).toBe(true);
      expect(progress.individualRemaining).toBe(3000); // 5000 - 1000 - 1000 = 3000
    });

    it('should default to family mode when no mortality manager is set', () => {
      const manager = new HealthcareManager([familyConfig]);

      const date = new Date('2024-06-15');

      // No mortality manager set, so should default to family mode
      const progress = manager.getDeductibleProgress(familyConfig, date, 'Jake');

      // Should use family limits
      expect(progress.familyRemaining).toBe(5000);
    });
  });
});
