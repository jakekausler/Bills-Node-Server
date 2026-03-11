import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthcareConfig } from '../../data/healthcare/types';

// Mock ./io before importing the module under test
vi.mock('./io', () => ({
  load: vi.fn(),
  save: vi.fn(),
  checkExists: vi.fn(),
}));

import { load, save } from './io';
import { loadHealthcareConfigs, saveHealthcareConfigs } from './healthcareConfigs';

const sampleConfig: HealthcareConfig = {
  id: 'config-1',
  name: 'Family Plan',
  coveredPersons: ['Alice', 'Bob'],
  startDate: '2024-01-01',
  endDate: null,
  individualDeductible: 1500,
  individualOutOfPocketMax: 5000,
  familyDeductible: 3000,
  familyOutOfPocketMax: 10000,
  hsaAccountId: 'hsa-account-1',
  hsaReimbursementEnabled: true,
  resetMonth: 0,
  resetDay: 1,
};

const anotherConfig: HealthcareConfig = {
  id: 'config-2',
  name: 'Individual Plan',
  coveredPersons: ['Charlie'],
  startDate: '2023-06-01',
  endDate: '2024-05-31',
  individualDeductible: 2500,
  individualOutOfPocketMax: 7500,
  familyDeductible: 5000,
  familyOutOfPocketMax: 15000,
  hsaAccountId: null,
  hsaReimbursementEnabled: false,
  resetMonth: 5,
  resetDay: 1,
};

describe('healthcareConfigs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadHealthcareConfigs', () => {
    it('should return empty array when file does not exist (ENOENT)', () => {
      const error = Object.assign(new Error('File not found'), { code: 'ENOENT' });
      vi.mocked(load).mockImplementationOnce(() => {
        throw error;
      });

      const result = loadHealthcareConfigs();

      expect(result).toEqual([]);
    });

    it('should return configs array when file exists and has data', () => {
      const fileData = { configs: [sampleConfig, anotherConfig] };
      vi.mocked(load).mockReturnValueOnce(fileData);

      const result = loadHealthcareConfigs();

      expect(result).toEqual([sampleConfig, anotherConfig]);
    });

    it('should return empty array when configs field is missing', () => {
      vi.mocked(load).mockReturnValueOnce({});

      const result = loadHealthcareConfigs();

      expect(result).toEqual([]);
    });

    it('should return empty array when configs field is empty array', () => {
      vi.mocked(load).mockReturnValueOnce({ configs: [] });

      const result = loadHealthcareConfigs();

      expect(result).toEqual([]);
    });

    it('should return single config correctly', () => {
      vi.mocked(load).mockReturnValueOnce({ configs: [sampleConfig] });

      const result = loadHealthcareConfigs();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(sampleConfig);
    });

    it('should call load with correct filename', () => {
      vi.mocked(load).mockReturnValueOnce({ configs: [] });

      loadHealthcareConfigs();

      expect(load).toHaveBeenCalledWith('healthcare_configs.json');
    });

    it('should throw error for non-ENOENT errors', () => {
      const permissionError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      vi.mocked(load).mockImplementationOnce(() => {
        throw permissionError;
      });

      expect(() => loadHealthcareConfigs()).toThrow('Permission denied');
    });

    it('should throw error for JSON parse errors', () => {
      const parseError = new Error('JSON parse failed');
      vi.mocked(load).mockImplementationOnce(() => {
        throw parseError;
      });

      expect(() => loadHealthcareConfigs()).toThrow('JSON parse failed');
    });

    it('should preserve all config fields when loading', () => {
      vi.mocked(load).mockReturnValueOnce({ configs: [sampleConfig] });

      const result = loadHealthcareConfigs();

      expect(result[0].id).toBe('config-1');
      expect(result[0].name).toBe('Family Plan');
      expect(result[0].coveredPersons).toEqual(['Alice', 'Bob']);
      expect(result[0].startDate).toBe('2024-01-01');
      expect(result[0].endDate).toBeNull();
      expect(result[0].individualDeductible).toBe(1500);
      expect(result[0].individualOutOfPocketMax).toBe(5000);
      expect(result[0].familyDeductible).toBe(3000);
      expect(result[0].familyOutOfPocketMax).toBe(10000);
      expect(result[0].hsaAccountId).toBe('hsa-account-1');
      expect(result[0].hsaReimbursementEnabled).toBe(true);
      expect(result[0].resetMonth).toBe(0);
      expect(result[0].resetDay).toBe(1);
    });
  });

  describe('saveHealthcareConfigs', () => {
    it('should call save with configs and filename', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      saveHealthcareConfigs([sampleConfig]);

      expect(save).toHaveBeenCalledWith({ configs: [sampleConfig] }, 'healthcare_configs.json');
    });

    it('should wrap configs in a HealthcareConfigsData object', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      saveHealthcareConfigs([sampleConfig, anotherConfig]);

      const callArgs = vi.mocked(save).mock.calls[0][0] as any;
      expect(callArgs).toHaveProperty('configs');
      expect(callArgs.configs).toHaveLength(2);
    });

    it('should save empty array correctly', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      saveHealthcareConfigs([]);

      expect(save).toHaveBeenCalledWith({ configs: [] }, 'healthcare_configs.json');
    });

    it('should save multiple configs correctly', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      saveHealthcareConfigs([sampleConfig, anotherConfig]);

      const callArgs = vi.mocked(save).mock.calls[0][0] as any;
      expect(callArgs.configs[0]).toEqual(sampleConfig);
      expect(callArgs.configs[1]).toEqual(anotherConfig);
    });

    it('should use correct filename', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      saveHealthcareConfigs([sampleConfig]);

      const [, filename] = vi.mocked(save).mock.calls[0];
      expect(filename).toBe('healthcare_configs.json');
    });

    it('should preserve all fields in saved config', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      saveHealthcareConfigs([sampleConfig]);

      const callArgs = vi.mocked(save).mock.calls[0][0] as any;
      expect(callArgs.configs[0]).toEqual(sampleConfig);
    });

    it('should propagate write errors', () => {
      const writeError = new Error('Disk full');
      vi.mocked(save).mockImplementationOnce(() => {
        throw writeError;
      });

      expect(() => saveHealthcareConfigs([sampleConfig])).toThrow('Disk full');
    });

    it('should preserve null hsaAccountId and endDate', () => {
      vi.mocked(save).mockImplementationOnce(() => {});

      const configWithNulls: HealthcareConfig = {
        ...sampleConfig,
        hsaAccountId: null,
        endDate: null,
      };

      saveHealthcareConfigs([configWithNulls]);

      const callArgs = vi.mocked(save).mock.calls[0][0] as any;
      expect(callArgs.configs[0].hsaAccountId).toBeNull();
      expect(callArgs.configs[0].endDate).toBeNull();
    });
  });
});
