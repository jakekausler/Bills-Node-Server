import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthcareConfig } from '../../data/healthcare/types';

// Mock fs/promises before importing the module under test
vi.mock('fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

// Mock path to make the resolved path predictable
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  };
});

import fs from 'fs/promises';
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
    it('should return empty array when file does not exist (ENOENT)', async () => {
      const error = Object.assign(new Error('File not found'), { code: 'ENOENT' });
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const result = await loadHealthcareConfigs();

      expect(result).toEqual([]);
    });

    it('should return configs array when file exists and has data', async () => {
      const fileData = { configs: [sampleConfig, anotherConfig] };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(fileData));

      const result = await loadHealthcareConfigs();

      expect(result).toEqual([sampleConfig, anotherConfig]);
    });

    it('should return empty array when configs field is missing', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}));

      const result = await loadHealthcareConfigs();

      expect(result).toEqual([]);
    });

    it('should return empty array when configs field is empty array', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ configs: [] }));

      const result = await loadHealthcareConfigs();

      expect(result).toEqual([]);
    });

    it('should return single config correctly', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ configs: [sampleConfig] }));

      const result = await loadHealthcareConfigs();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(sampleConfig);
    });

    it('should read file with utf-8 encoding', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ configs: [] }));

      await loadHealthcareConfigs();

      expect(fs.readFile).toHaveBeenCalledWith(expect.any(String), 'utf-8');
    });

    it('should throw error for non-ENOENT errors', async () => {
      const permissionError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });
      vi.mocked(fs.readFile).mockRejectedValue(permissionError);

      await expect(loadHealthcareConfigs()).rejects.toThrow('Permission denied');
    });

    it('should throw error for JSON parse errors', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json {{{');

      await expect(loadHealthcareConfigs()).rejects.toThrow();
    });

    it('should preserve all config fields when loading', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ configs: [sampleConfig] }));

      const result = await loadHealthcareConfigs();

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
    it('should write configs to file as JSON', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveHealthcareConfigs([sampleConfig]);

      expect(fs.writeFile).toHaveBeenCalledTimes(1);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify({ configs: [sampleConfig] }, null, 2),
        'utf-8',
      );
    });

    it('should wrap configs in a HealthcareConfigsData object', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveHealthcareConfigs([sampleConfig, anotherConfig]);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const parsedContent = JSON.parse(writtenContent);

      expect(parsedContent).toHaveProperty('configs');
      expect(parsedContent.configs).toHaveLength(2);
    });

    it('should save empty array correctly', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveHealthcareConfigs([]);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.any(String),
        JSON.stringify({ configs: [] }, null, 2),
        'utf-8',
      );
    });

    it('should save multiple configs correctly', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveHealthcareConfigs([sampleConfig, anotherConfig]);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const parsedContent = JSON.parse(writtenContent);

      expect(parsedContent.configs[0]).toEqual(sampleConfig);
      expect(parsedContent.configs[1]).toEqual(anotherConfig);
    });

    it('should write with utf-8 encoding', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveHealthcareConfigs([sampleConfig]);

      expect(fs.writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'utf-8');
    });

    it('should write formatted JSON with 2-space indentation', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await saveHealthcareConfigs([sampleConfig]);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;

      // Verify it's formatted (contains newlines and spaces)
      expect(writtenContent).toContain('\n');
      expect(writtenContent).toContain('  ');
    });

    it('should propagate write errors', async () => {
      const writeError = new Error('Disk full');
      vi.mocked(fs.writeFile).mockRejectedValue(writeError);

      await expect(saveHealthcareConfigs([sampleConfig])).rejects.toThrow('Disk full');
    });

    it('should preserve null hsaAccountId and endDate', async () => {
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const configWithNulls: HealthcareConfig = {
        ...sampleConfig,
        hsaAccountId: null,
        endDate: null,
      };

      await saveHealthcareConfigs([configWithNulls]);

      const writtenContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);

      expect(parsed.configs[0].hsaAccountId).toBeNull();
      expect(parsed.configs[0].endDate).toBeNull();
    });
  });
});
