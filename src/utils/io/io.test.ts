import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } from 'fs';
import { load, save, backup, shouldBackup, checkExists, BASE_DATA_DIR } from './io';

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

// Mock path module
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    join: vi.fn((...args) => args.join('/')),
    dirname: vi.fn(() => '/mock/dirname'),
  };
});

// Mock url module
vi.mock('url', () => ({
  fileURLToPath: vi.fn(() => '/mock/file/path'),
}));

describe('IO utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('load', () => {
    it('should load and parse JSON data from file', () => {
      const mockData = { test: 'data', value: 123 };
      const mockFileContent = JSON.stringify(mockData);
      
      vi.mocked(readFileSync).mockReturnValue(mockFileContent);

      const result = load<typeof mockData>('test.json');

      expect(readFileSync).toHaveBeenCalledWith(`${BASE_DATA_DIR}/test.json`, 'utf8');
      expect(result).toEqual(mockData);
    });

    it('should handle parsing errors gracefully', () => {
      vi.mocked(readFileSync).mockReturnValue('invalid json');

      expect(() => load('test.json')).toThrow();
    });
  });

  describe('checkExists', () => {
    it('should check if file exists', () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const result = checkExists('test.json');

      expect(existsSync).toHaveBeenCalledWith(`${BASE_DATA_DIR}/test.json`);
      expect(result).toBe(true);
    });

    it('should return false if file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = checkExists('nonexistent.json');

      expect(existsSync).toHaveBeenCalledWith(`${BASE_DATA_DIR}/nonexistent.json`);
      expect(result).toBe(false);
    });
  });

  describe('backup', () => {
    it('should create backup directory if it does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(readdirSync).mockReturnValue([]);

      backup('test.json');

      expect(mkdirSync).toHaveBeenCalledWith(`${BASE_DATA_DIR}/backup`);
    });

    it('should copy file to backup directory with timestamp', () => {
      const mockTimestamp = 1640995200000; // Fixed timestamp for testing
      vi.spyOn(Date, 'now').mockReturnValue(mockTimestamp);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      backup('test.json');

      expect(copyFileSync).toHaveBeenCalledWith(
        `${BASE_DATA_DIR}/test.json`,
        `${BASE_DATA_DIR}/backup/test.json.${mockTimestamp}`
      );
    });

    it('should remove oldest backup when max backups exceeded', () => {
      const mockBackups = [
        'test.json.1640995100000',
        'test.json.1640995200000',
        'test.json.1640995300000',
        'test.json.1640995400000',
        'test.json.1640995500000',
        'test.json.1640995600000',
        'test.json.1640995700000',
        'test.json.1640995800000',
        'test.json.1640995900000',
        'test.json.1640996000000', // 10 backups
      ];
      
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue(mockBackups);

      backup('test.json');

      expect(unlinkSync).toHaveBeenCalledWith(`${BASE_DATA_DIR}/backup/test.json.1640995100000`);
    });
  });

  describe('shouldBackup', () => {
    it('should return true when save counter reaches threshold', () => {
      // First 9 calls should return false
      for (let i = 0; i < 9; i++) {
        expect(shouldBackup('test.json')).toBe(false);
      }
      
      // 10th call should return true
      expect(shouldBackup('test.json')).toBe(true);
      
      // Counter should reset, so next call returns false
      expect(shouldBackup('test.json')).toBe(false);
    });

    it('should track separate counters for different files', () => {
      // Increment counters for two different files
      for (let i = 0; i < 9; i++) {
        expect(shouldBackup('file1.json')).toBe(false);
        expect(shouldBackup('file2.json')).toBe(false);
      }
      
      // Both should reach threshold at the same time
      expect(shouldBackup('file1.json')).toBe(true);
      expect(shouldBackup('file2.json')).toBe(true);
    });
  });

  describe('save', () => {
    it('should save data to file without backup when threshold not reached', () => {
      const mockData = { test: 'data' };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      save(mockData, 'test.json');

      expect(writeFileSync).toHaveBeenCalledWith(
        `${BASE_DATA_DIR}/test.json`,
        JSON.stringify(mockData, null, 2)
      );
      expect(copyFileSync).not.toHaveBeenCalled();
    });

    it('should trigger backup when save threshold is reached', () => {
      const mockData = { test: 'data' };
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdirSync).mockReturnValue([]);

      // Use a unique filename to avoid counter conflicts
      const uniqueFilename = 'backup-test.json';
      
      // Increment counter to threshold
      for (let i = 0; i < 9; i++) {
        save(mockData, uniqueFilename);
      }
      
      vi.clearAllMocks();
      
      // This save should trigger backup
      save(mockData, uniqueFilename);

      expect(copyFileSync).toHaveBeenCalled();
      expect(writeFileSync).toHaveBeenCalled();
    });

    it('should serialize data correctly', () => {
      const mockData = {
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: 'value' },
      };

      save(mockData, 'test.json');

      expect(writeFileSync).toHaveBeenCalledWith(
        `${BASE_DATA_DIR}/test.json`,
        JSON.stringify(mockData, null, 2)
      );
    });
  });
});