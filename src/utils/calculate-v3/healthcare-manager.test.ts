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
});
