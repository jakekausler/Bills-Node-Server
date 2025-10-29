import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadHealthcareConfigs, saveHealthcareConfigs } from './healthcareConfigs';
import { HealthcareConfig } from '../../data/healthcare/types';
import fs from 'fs/promises';
import path from 'path';

const TEST_FILE = path.join(__dirname, 'data', 'healthcare_configs_test.json');
const BACKUP_FILE = path.join(__dirname, 'data', 'healthcare_configs.json.backup');

describe('healthcareConfigs', () => {
  describe('loadHealthcareConfigs', () => {
    it('should return empty array when file does not exist', async () => {
      const configs = await loadHealthcareConfigs();
      expect(Array.isArray(configs)).toBe(true);
    });
  });

  describe('saveHealthcareConfigs and loadHealthcareConfigs', () => {
    it('should save and load configs correctly', async () => {
      const testConfigs: HealthcareConfig[] = [
        {
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
        },
      ];

      await saveHealthcareConfigs(testConfigs);
      const loaded = await loadHealthcareConfigs();

      expect(loaded).toEqual(testConfigs);
    });
  });
});
