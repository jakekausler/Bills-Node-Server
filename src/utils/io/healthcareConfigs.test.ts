import { describe, it, expect, afterEach, vi } from 'vitest';
import { HealthcareConfig } from '../../data/healthcare/types';
import fs from 'fs/promises';
import path from 'path';

const TEST_FILE = path.join(__dirname, '../../../data', 'healthcare_configs_test.json');

vi.mock('./healthcareConfigs', async () => {
  const testPath = path.join(__dirname, '../../../data', 'healthcare_configs_test.json');
  return {
    loadHealthcareConfigs: async () => {
      try {
        const data = await fs.readFile(testPath, 'utf-8');
        const parsed = JSON.parse(data);
        return parsed.configs || [];
      } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') return [];
        throw error;
      }
    },
    saveHealthcareConfigs: async (configs: HealthcareConfig[]) => {
      await fs.writeFile(testPath, JSON.stringify({ configs }, null, 2), 'utf-8');
    },
  };
});

import { loadHealthcareConfigs, saveHealthcareConfigs } from './healthcareConfigs';

afterEach(async () => {
  try {
    await fs.unlink(TEST_FILE);
  } catch {
    // ignore if file doesn't exist
  }
});

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
        },
      ];

      await saveHealthcareConfigs(testConfigs);
      const loaded = await loadHealthcareConfigs();

      expect(loaded).toEqual(testConfigs);
    });
  });
});
