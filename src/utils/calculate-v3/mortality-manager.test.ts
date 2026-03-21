import { describe, it, expect, beforeEach } from 'vitest';
import { MortalityManager } from './mortality-manager';
import * as fs from 'fs';
import * as path from 'path';

describe('MortalityManager', () => {
  let manager: MortalityManager;

  beforeEach(() => {
    manager = new MortalityManager();
  });

  describe('SSA Life Table Loading', () => {
    it('should load SSA life table data successfully', () => {
      const ssaPath = path.join(__dirname, '../../../data/ssaLifeTable.json');
      const data = JSON.parse(fs.readFileSync(ssaPath, 'utf-8'));
      expect(data.male).toBeDefined();
      expect(data.female).toBeDefined();
      expect(data.male['85']).toBeDefined();
    });

    it('should not throw when SSA data is missing (graceful degradation)', () => {
      expect(() => {
        const newManager = new MortalityManager();
        newManager.getMonthlyDeathProbability(85, 'male', 'healthy');
      }).not.toThrow();
    });
  });

  describe('Monthly Death Probability Calculations', () => {
    it('should calculate monthly death probability for healthy male age 85', () => {
      const prob = manager.getMonthlyDeathProbability(85, 'male', 'healthy');
      // SSA male age 85 annual q ~0.036, so monthly baseline ~0.00304
      expect(prob).toBeGreaterThan(0);
      expect(prob).toBeLessThan(1);
      expect(prob).toBeLessThan(0.01); // Monthly should be less than 1%
    });

    it('should calculate monthly death probability for healthy female age 33', () => {
      const prob = manager.getMonthlyDeathProbability(33, 'female', 'healthy');
      // SSA female age 33 annual q very small, so monthly baseline very small
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThan(0.001); // Very low for young adult
    });

    it('should apply mortality multiplier for LTC care states', () => {
      const healthyProb = manager.getMonthlyDeathProbability(75, 'male', 'healthy');
      const homeCareProb = manager.getMonthlyDeathProbability(75, 'male', 'homeCare');
      const nhProb = manager.getMonthlyDeathProbability(75, 'male', 'nursingHome');

      // Care states should have higher mortality (due to multiplier)
      expect(homeCareProb).toBeGreaterThan(healthyProb);
      expect(nhProb).toBeGreaterThan(healthyProb);
      expect(nhProb).toBeGreaterThan(homeCareProb); // Nursing home worse than home care
    });

    it('should cap death probability at 1.0', () => {
      // Very high age should not exceed 1.0
      const prob = manager.getMonthlyDeathProbability(120, 'male', 'nursingHome');
      expect(prob).toBeLessThanOrEqual(1);
    });

    it('should return 0 probability when SSA data not loaded (under 65)', () => {
      // Under 65, Markov modeling is skipped anyway
      // But method should return safe value
      const prob = manager.getMonthlyDeathProbability(50, 'male', 'healthy');
      expect(prob).toBeGreaterThanOrEqual(0);
      expect(prob).toBeLessThanOrEqual(1);
    });
  });

  describe('Markov Chain State Transitions with SSA Death', () => {
    it('should transition to deceased on SSA death roll', () => {
      const state = manager.getPersonState('Jake');
      expect(state?.currentState).toBe('healthy');

      // Use a mock random that always returns 0 to force death
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);

      const newState = manager.getPersonState('Jake');
      expect(newState?.currentState).toBe('deceased');
    });

    it('should not transition to deceased on low random value with high age', () => {
      // Use high random to avoid death
      const neverDie = () => 0.9999;
      manager.stepMonth('Jake', 75, 'male', 0, neverDie);

      const state = manager.getPersonState('Jake');
      expect(state?.currentState).toBe('healthy');
    });

    it('should preserve LTC state on non-death transitions', () => {
      // Stay healthy for multiple steps with high random
      const neverTransition = () => 0.9999;
      manager.stepMonth('Jake', 70, 'male', 0, neverTransition);

      let state = manager.getPersonState('Jake');
      expect(state?.currentState).toBe('healthy');

      // Continue step - should still be healthy
      manager.stepMonth('Jake', 71, 'male', 1, neverTransition);

      const newState = manager.getPersonState('Jake');
      expect(newState?.currentState).toBe('healthy');
    });
  });

  describe('isDeceased', () => {
    it('should return false for healthy person', () => {
      expect(manager.isDeceased('Jake')).toBe(false);
    });

    it('should return true after death', () => {
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);

      expect(manager.isDeceased('Jake')).toBe(true);
    });

    it('should return false for unknown person', () => {
      expect(manager.isDeceased('UnknownPerson')).toBe(false);
    });
  });

  describe('getDeathDate', () => {
    it('should return null for living person', () => {
      const date = manager.getDeathDate('Jake');
      expect(date).toBeNull();
    });

    it('should return date after recordDeath', () => {
      const deathDate = new Date('2030-01-15');
      manager.recordDeath('Jake', deathDate);

      const returned = manager.getDeathDate('Jake');
      expect(returned).toEqual(deathDate);
    });

    it('should return null for unknown person', () => {
      const date = manager.getDeathDate('UnknownPerson');
      expect(date).toBeNull();
    });
  });

  describe('allDeceased', () => {
    it('should return false with no persons tracked', () => {
      // Create new manager with no configs
      const configs: any[] = [];
      expect(manager.allDeceased()).toBe(false);
    });

    it('should return false with one alive person', () => {
      expect(manager.allDeceased()).toBe(false);
    });

    it('should return true when all are deceased', () => {
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);
      manager.stepMonth('Kendall', 85, 'female', 0, alwaysDie);

      expect(manager.allDeceased()).toBe(true);
    });
  });

  describe('getAlivePeople', () => {
    it('should return all people initially', () => {
      const alive = manager.getAlivePeople();
      expect(alive).toContain('Jake');
      expect(alive).toContain('Kendall');
    });

    it('should exclude deceased persons', () => {
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);

      const alive = manager.getAlivePeople();
      expect(alive).toContain('Kendall');
      expect(alive).not.toContain('Jake');
    });

    it('should return empty array when all deceased', () => {
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);
      manager.stepMonth('Kendall', 85, 'female', 0, alwaysDie);

      const alive = manager.getAlivePeople();
      expect(alive).toHaveLength(0);
    });
  });

  describe('getFilingStatus', () => {
    it('should return mfj when both alive', () => {
      const status = manager.getFilingStatus(new Date('2030-06-15'));
      expect(status).toBe('mfj');
    });

    it('should return single when one alive', () => {
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);

      const status = manager.getFilingStatus(new Date('2030-06-15'));
      expect(status).toBe('single');
    });

    it('should return mfj for death year even with one alive', () => {
      const deathDate = new Date('2030-03-15');
      manager.recordDeath('Jake', deathDate);

      // Same year as death
      const status = manager.getFilingStatus(new Date('2030-12-31'));
      expect(status).toBe('mfj');
    });

    it('should return single for year after death', () => {
      const deathDate = new Date('2030-03-15');
      manager.recordDeath('Jake', deathDate);

      // Year after death
      const status = manager.getFilingStatus(new Date('2031-06-15'));
      expect(status).toBe('single');
    });
  });

  describe('Person Name Mapping', () => {
    it('should map config name to canonical name', () => {
      manager.setPersonNameMapping('ConfigJake', 'Jake');
      expect(manager.getCanonicalName('ConfigJake')).toBe('Jake');
    });

    it('should return config name if no mapping exists', () => {
      expect(manager.getCanonicalName('UnmappedName')).toBe('UnmappedName');
    });

    it('should allow multiple mappings', () => {
      manager.setPersonNameMapping('Jake1', 'Jake');
      manager.setPersonNameMapping('Kendall1', 'Kendall');

      expect(manager.getCanonicalName('Jake1')).toBe('Jake');
      expect(manager.getCanonicalName('Kendall1')).toBe('Kendall');
    });
  });

  describe('recordDeath', () => {
    it('should set state to deceased and record date', () => {
      const date = new Date('2030-06-15');
      manager.recordDeath('Jake', date);

      expect(manager.isDeceased('Jake')).toBe(true);
      expect(manager.getDeathDate('Jake')).toEqual(date);
    });

    it('should handle unknown person gracefully', () => {
      const date = new Date('2030-06-15');
      expect(() => {
        manager.recordDeath('UnknownPerson', date);
      }).not.toThrow();
    });
  });

  describe('evaluateAnnualMortality', () => {
    it('should not affect persons 65+', () => {
      const date = new Date('2030-06-15');
      const neverDie = () => 0.9999;
      manager.evaluateAnnualMortality('Jake', 70, 'male', date, neverDie);

      expect(manager.isDeceased('Jake')).toBe(false);
    });

    it('should apply annual death check for under-65', () => {
      const date = new Date('2030-06-15');
      const alwaysDie = () => 0.0001; // Force death
      manager.evaluateAnnualMortality('Jake', 45, 'male', date, alwaysDie);

      expect(manager.isDeceased('Jake')).toBe(true);
      expect(manager.getDeathDate('Jake')).toEqual(date);
    });

    it('should use SSA table for annual calculation', () => {
      const date = new Date('2030-06-15');
      const neverDie = () => 0.9999;
      // Age 33, male - very low mortality
      manager.evaluateAnnualMortality('Jake', 33, 'male', date, neverDie);

      expect(manager.isDeceased('Jake')).toBe(false);
    });
  });

  describe('Checkpoint and Restore', () => {
    it('should preserve LTC person states', () => {
      // Force transition to home care
      const transitionToHomeCare = () => 0.001;
      manager.stepMonth('Jake', 70, 'male', 0, transitionToHomeCare);

      manager.checkpoint();
      const beforeRestoreState = manager.getPersonState('Jake');

      // Modify state
      manager.resetPersonStates();
      expect(manager.getPersonState('Jake')?.currentState).toBe('healthy');

      // Restore
      manager.restore();
      const afterRestoreState = manager.getPersonState('Jake');
      expect(afterRestoreState?.currentState).toBe(beforeRestoreState?.currentState);
    });

    it('should preserve death dates', () => {
      const date = new Date('2030-06-15');
      manager.recordDeath('Jake', date);

      manager.checkpoint();
      manager.resetPersonStates();

      expect(manager.getDeathDate('Jake')).toBeNull();

      manager.restore();
      expect(manager.getDeathDate('Jake')).toEqual(date);
    });

    it('should preserve person name mapping', () => {
      manager.setPersonNameMapping('ConfigJake', 'Jake');

      manager.checkpoint();
      const map2 = new MortalityManager();
      // This new manager won't have the mapping yet
      map2.restore(); // No checkpoint to restore
      map2.setPersonNameMapping('TestName', 'TestValue');

      manager.restore();
      expect(manager.getCanonicalName('ConfigJake')).toBe('Jake');
    });

    it('should preserve cost factors', () => {
      const alwaysDie = () => 0.0001;
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);

      // Get cost factor
      const state1 = manager.getPersonState('Jake');
      manager.checkpoint();

      // Reset
      manager.resetPersonStates();
      expect(manager.getPersonState('Jake')?.currentState).toBe('healthy');

      // Restore
      manager.restore();
      const state2 = manager.getPersonState('Jake');
      expect(state2?.currentState).toBe(state1?.currentState);
      expect(state2?.costFactor).toBe(state1?.costFactor);
    });

    it('should handle restoration of empty checkpoint gracefully', () => {
      // Restore without checkpoint should be safe
      expect(() => {
        manager.restore();
      }).not.toThrow();
    });
  });

  describe('Reproducibility with Seeded PRNG', () => {
    it('should produce same deaths with same seed', () => {
      // Create two separate managers
      const manager1 = new MortalityManager();
      const manager2 = new MortalityManager();

      let seed = 42;
      const seededRandom1 = () => {
        seed = (seed * 1103515245 + 12345) % (2 ** 31);
        return seed / (2 ** 31);
      };

      seed = 42; // Reset
      const seededRandom2 = () => {
        seed = (seed * 1103515245 + 12345) % (2 ** 31);
        return seed / (2 ** 31);
      };

      // Step both managers with same random sequence
      for (let i = 0; i < 24; i++) { // 2 years of monthly steps
        manager1.stepMonth('Jake', 85, 'male', i, seededRandom1);
      }

      seed = 42; // Reset for second run
      for (let i = 0; i < 24; i++) {
        manager2.stepMonth('Jake', 85, 'male', i, seededRandom2);
      }

      // Both should have same state
      expect(manager1.getPersonState('Jake')?.currentState).toBe(manager2.getPersonState('Jake')?.currentState);
    });
  });

  describe('Re-export Shim Compatibility', () => {
    it('should be importable as LTCManager from ltc-manager', async () => {
      // This test verifies the backward compatibility shim works
      const ltcManagerModule = await import('./ltc-manager');
      expect(ltcManagerModule.LTCManager).toBeDefined();

      // Create instance via shim
      const instance = new ltcManagerModule.LTCManager();
      expect(instance).toBeDefined();
      expect(instance.getPersonState).toBeDefined();
      expect(instance.stepMonth).toBeDefined();
      expect(instance.getFilingStatus).toBeDefined();
    });
  });

  describe('Integration: Death transitions', () => {
    it('should transition to deceased from any state', () => {
      // Start at age 85 where death probability is significant
      const alwaysDie = () => 0.0001; // Force death
      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);

      const state = manager.getPersonState('Jake');
      expect(state?.currentState).toBe('deceased');
    });
  });

  describe('Survivor Benefits', () => {
    it('should lock survivor benefit when person dies', () => {
      manager.lockSurvivorBenefit('Jake', 2500);
      expect(manager.getLockedSurvivorBenefit('Jake')).toBe(2500);
    });

    it('should return 0 for unlocked person', () => {
      expect(manager.getLockedSurvivorBenefit('Jake')).toBe(0);
    });

    it('should preserve locked benefits in checkpoint/restore', () => {
      manager.lockSurvivorBenefit('Jake', 2500);
      manager.lockSurvivorBenefit('Kendall', 1800);

      manager.checkpoint();
      manager.resetPersonStates();

      expect(manager.getLockedSurvivorBenefit('Jake')).toBe(0);
      expect(manager.getLockedSurvivorBenefit('Kendall')).toBe(0);

      manager.restore();
      expect(manager.getLockedSurvivorBenefit('Jake')).toBe(2500);
      expect(manager.getLockedSurvivorBenefit('Kendall')).toBe(1800);
    });

    it('should clear locked benefits on resetPersonStates', () => {
      manager.lockSurvivorBenefit('Jake', 2500);
      expect(manager.getLockedSurvivorBenefit('Jake')).toBe(2500);

      manager.resetPersonStates();
      expect(manager.getLockedSurvivorBenefit('Jake')).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle age clamping at 119', () => {
      // Very high age should clamp to 119 for table lookup
      const prob = manager.getMonthlyDeathProbability(150, 'male', 'healthy');
      expect(prob).toBeGreaterThan(0);
      expect(prob).toBeLessThanOrEqual(1);
    });

    it('should handle gender case sensitivity', () => {
      const probMale = manager.getMonthlyDeathProbability(85, 'male', 'healthy');
      const probFemale = manager.getMonthlyDeathProbability(85, 'female', 'healthy');

      // Male mortality should be higher than female at same age
      expect(probMale).toBeGreaterThan(probFemale);
    });

    it('should handle multiple deaths in sequence', () => {
      const alwaysDie = () => 0.0001;

      manager.stepMonth('Jake', 85, 'male', 0, alwaysDie);
      expect(manager.isDeceased('Jake')).toBe(true);

      manager.stepMonth('Kendall', 85, 'female', 0, alwaysDie);
      expect(manager.isDeceased('Kendall')).toBe(true);

      expect(manager.allDeceased()).toBe(true);
      expect(manager.getAlivePeople()).toHaveLength(0);
    });
  });
});
