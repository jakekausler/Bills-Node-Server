import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before importing the module under test
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Mock csv-parse/sync
vi.mock('csv-parse/sync', () => ({
  parse: vi.fn(),
}));

// Mock the io module
vi.mock('./io', () => ({
  backup: vi.fn(),
  shouldBackup: vi.fn().mockReturnValue(false),
  BASE_DATA_DIR: '/mock/data',
}));

// Mock the loadVariableValue function
vi.mock('../simulation/loadVariableValue', () => ({
  loadVariableValue: vi.fn(),
}));

// Mock path
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join('/')),
  };
});

// Mock formatDate
vi.mock('../date/date', () => ({
  formatDate: vi.fn((date: Date) => date.toISOString().split('T')[0]),
}));

import { readFileSync, writeFileSync } from 'fs';
import { parse as parseSync } from 'csv-parse/sync';
import { backup, shouldBackup } from './io';
import { loadVariableValue } from '../simulation/loadVariableValue';
import { loadVariables, saveVariables } from './variable';

describe('variable IO functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shouldBackup to return false by default
    vi.mocked(shouldBackup).mockReturnValue(false);
  });

  describe('loadVariables', () => {
    it('should read variables.csv from the data directory', () => {
      vi.mocked(readFileSync).mockReturnValue('variable,Default\nrate,0.05');
      vi.mocked(parseSync).mockReturnValue([]);

      loadVariables('Default');

      expect(readFileSync).toHaveBeenCalledWith(expect.stringContaining('variables.csv'), 'utf-8');
    });

    it('should call parseSync with columns: true option', () => {
      vi.mocked(readFileSync).mockReturnValue('variable,Default\nrate,0.05');
      vi.mocked(parseSync).mockReturnValue([]);

      loadVariables('Default');

      expect(parseSync).toHaveBeenCalledWith(expect.any(String), { columns: true });
    });

    it('should return an empty Variables object when CSV has no data rows', () => {
      vi.mocked(readFileSync).mockReturnValue('variable,Default');
      vi.mocked(parseSync).mockReturnValue([]);

      const result = loadVariables('Default');

      expect(result).toEqual({});
    });

    it('should call loadVariableValue for each row with the correct simulation column', () => {
      vi.mocked(readFileSync).mockReturnValue('variable,Default\nrate,0.05\ninitialBalance,100000');
      vi.mocked(parseSync).mockReturnValue([
        { variable: 'rate', Default: '0.05' },
        { variable: 'initialBalance', Default: '100000' },
      ]);
      vi.mocked(loadVariableValue)
        .mockReturnValueOnce({ type: 'amount', value: 0.05 })
        .mockReturnValueOnce({ type: 'amount', value: 100000 });

      loadVariables('Default');

      expect(loadVariableValue).toHaveBeenCalledWith('0.05');
      expect(loadVariableValue).toHaveBeenCalledWith('100000');
      expect(loadVariableValue).toHaveBeenCalledTimes(2);
    });

    it('should map variable names to their parsed values', () => {
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseSync).mockReturnValue([
        { variable: 'rate', Default: '0.05' },
        { variable: 'retirementDate', Default: '2030-01-01' },
      ]);
      const rateValue = { type: 'amount' as const, value: 0.05 };
      const dateValue = { type: 'date' as const, value: new Date('2030-01-01') };
      vi.mocked(loadVariableValue).mockReturnValueOnce(rateValue).mockReturnValueOnce(dateValue);

      const result = loadVariables('Default');

      expect(result).toEqual({
        rate: rateValue,
        retirementDate: dateValue,
      });
    });

    it('should use the correct simulation column when multiple simulations exist', () => {
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseSync).mockReturnValue([
        { variable: 'rate', Default: '0.05', Conservative: '0.03' },
      ]);
      vi.mocked(loadVariableValue).mockReturnValue({ type: 'amount', value: 0.03 });

      loadVariables('Conservative');

      expect(loadVariableValue).toHaveBeenCalledWith('0.03');
    });

    it('should skip rows that have only one key (no simulation columns)', () => {
      vi.mocked(readFileSync).mockReturnValue('');
      // A row with only 'variable' key (Object.keys.length === 1)
      vi.mocked(parseSync).mockReturnValue([
        { variable: 'onlyKey' },
      ]);

      const result = loadVariables('Default');

      expect(loadVariableValue).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it('should handle rows with more than two keys', () => {
      vi.mocked(readFileSync).mockReturnValue('');
      vi.mocked(parseSync).mockReturnValue([
        { variable: 'rate', Default: '0.05', Conservative: '0.03', Aggressive: '0.08' },
      ]);
      vi.mocked(loadVariableValue).mockReturnValue({ type: 'amount', value: 0.05 });

      const result = loadVariables('Default');

      expect(loadVariableValue).toHaveBeenCalledWith('0.05');
      expect(result).toHaveProperty('rate');
    });

    it('should propagate errors from readFileSync', () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() => loadVariables('Default')).toThrow('File not found');
    });

    it('should propagate errors from parseSync', () => {
      vi.mocked(readFileSync).mockReturnValue('bad csv content');
      vi.mocked(parseSync).mockImplementation(() => {
        throw new Error('CSV parse error');
      });

      expect(() => loadVariables('Default')).toThrow('CSV parse error');
    });
  });

  describe('saveVariables', () => {
    it('should not call backup when shouldBackup returns false', () => {
      vi.mocked(shouldBackup).mockReturnValue(false);

      saveVariables([]);

      expect(backup).not.toHaveBeenCalled();
    });

    it('should call backup when shouldBackup returns true', () => {
      vi.mocked(shouldBackup).mockReturnValue(true);

      saveVariables([]);

      expect(backup).toHaveBeenCalledWith('variables.csv');
    });

    it('should check shouldBackup for variables.csv', () => {
      vi.mocked(shouldBackup).mockReturnValue(false);

      saveVariables([]);

      expect(shouldBackup).toHaveBeenCalledWith('variables.csv');
    });

    it('should write header row with variable + simulation names', () => {
      const simulations = [
        { name: 'Default', enabled: true, selected: true, variables: {} },
        { name: 'Conservative', enabled: true, selected: false, variables: {} },
      ];

      saveVariables(simulations);

      const expectedContent = '"variable","Default","Conservative"';
      expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('variables.csv'), expect.stringContaining(expectedContent));
    });

    it('should write sorted variable rows for each simulation', () => {
      const simulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          variables: {
            zVariable: { type: 'amount' as const, value: 100 },
            aVariable: { type: 'amount' as const, value: 200 },
          },
        },
      ];

      saveVariables(simulations);

      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const content = callArgs[1] as string;

      // Variables should be written in sorted order (aVariable before zVariable)
      const lines = content.split('\n');
      const aVariableLine = lines.find(line => line.startsWith('"aVariable"'));
      const zVariableLine = lines.find(line => line.startsWith('"zVariable"'));

      expect(aVariableLine).toBeDefined();
      expect(zVariableLine).toBeDefined();
      expect(content.indexOf('"aVariable"')).toBeLessThan(content.indexOf('"zVariable"'));
    });

    it('should write number values as strings', () => {
      const simulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          variables: {
            rate: { type: 'amount' as const, value: 0.05 },
          },
        },
      ];

      saveVariables(simulations);

      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const content = callArgs[1] as string;

      expect(content).toContain('"rate","0.05"');
    });

    it('should write string values as strings', () => {
      const simulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          variables: {
            label: { type: 'amount' as const, value: 'someString' },
          },
        },
      ];

      saveVariables(simulations);

      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const content = callArgs[1] as string;

      expect(content).toContain('"label","someString"');
    });

    it('should format Date values using formatDate utility', () => {
      const testDate = new Date('2030-01-15T12:00:00Z');
      const simulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          variables: {
            retirementDate: { type: 'date' as const, value: testDate },
          },
        },
      ];

      saveVariables(simulations);

      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const content = callArgs[1] as string;

      // formatDate is mocked to return ISO date string split at T
      expect(content).toContain('"retirementDate","2030-01-15"');
    });

    it('should write content to variables.csv using writeFileSync', () => {
      saveVariables([{ name: 'Default', enabled: true, selected: true, variables: {} }]);

      expect(writeFileSync).toHaveBeenCalledWith(expect.stringContaining('variables.csv'), expect.any(String));
    });

    it('should collect all unique variable names across simulations that share the same variables', () => {
      // All simulations must share the same variable keys — the source code accesses
      // simulation.variables[variable] for every collected variable name without null-checking
      const simulations = [
        {
          name: 'Sim1',
          enabled: true,
          selected: true,
          variables: {
            varA: { type: 'amount' as const, value: 1 },
            varB: { type: 'amount' as const, value: 2 },
            varC: { type: 'amount' as const, value: 3 },
          },
        },
        {
          name: 'Sim2',
          enabled: true,
          selected: false,
          variables: {
            varA: { type: 'amount' as const, value: 10 },
            varB: { type: 'amount' as const, value: 20 },
            varC: { type: 'amount' as const, value: 30 },
          },
        },
      ];

      saveVariables(simulations);

      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const content = callArgs[1] as string;

      // Should have variable rows written in sorted order
      expect(content).toContain('"varA"');
      expect(content).toContain('"varB"');
      expect(content).toContain('"varC"');

      // Check order
      expect(content.indexOf('"varA"')).toBeLessThan(content.indexOf('"varB"'));
      expect(content.indexOf('"varB"')).toBeLessThan(content.indexOf('"varC"'));
    });

    it('should handle empty simulations array', () => {
      saveVariables([]);

      const callArgs = vi.mocked(writeFileSync).mock.calls[0];
      const content = callArgs[1] as string;

      // Should write header row with only 'variable' column
      expect(content).toContain('"variable"');
    });
  });
});
