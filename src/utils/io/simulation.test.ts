import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSimulations, saveSimulations, getSimulationOverrides } from './simulation';
import { load, save } from './io';
import { loadVariables, saveVariables } from './variable';
import { resetCache } from './cache';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking style: vi.mock() entire modules, vi.mocked() for typed access
// - Assertion library: expect()

vi.mock('./io');
vi.mock('./variable');
vi.mock('./cache');

describe('simulation IO functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('loadSimulations', () => {
    it('should load simulations from simulations.json and attach variables', () => {
      const mockLoadedSimulations = [
        { name: 'Base Scenario', enabled: true, selected: true },
        { name: 'Conservative', enabled: true, selected: false },
      ];

      const mockBaseVariables = {
        retirementDate: { type: 'date' as const, value: '2030-01-01' as const },
      };
      const mockConservativeVariables = {
        retirementDate: { type: 'date' as const, value: '2028-06-01' as const },
      };

      vi.mocked(load).mockReturnValue(mockLoadedSimulations);
      vi.mocked(loadVariables)
        .mockReturnValueOnce(mockBaseVariables)
        .mockReturnValueOnce(mockConservativeVariables);

      const result = loadSimulations();

      expect(load).toHaveBeenCalledWith('simulations.json');
      expect(loadVariables).toHaveBeenCalledWith('Base Scenario');
      expect(loadVariables).toHaveBeenCalledWith('Conservative');
      expect(result).toEqual([
        {
          name: 'Base Scenario',
          enabled: true,
          selected: true,
          variables: mockBaseVariables,
        },
        {
          name: 'Conservative',
          enabled: true,
          selected: false,
          variables: mockConservativeVariables,
        },
      ]);
    });

    it('should return an empty array when no simulations exist', () => {
      vi.mocked(load).mockReturnValue([]);

      const result = loadSimulations();

      expect(load).toHaveBeenCalledWith('simulations.json');
      expect(loadVariables).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should handle a single simulation', () => {
      const mockLoadedSimulations = [{ name: 'Only Scenario', enabled: false, selected: true }];
      const mockVariables = { initialBalance: { type: 'amount' as const, value: 100000 } };

      vi.mocked(load).mockReturnValue(mockLoadedSimulations);
      vi.mocked(loadVariables).mockReturnValue(mockVariables);

      const result = loadSimulations();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Only Scenario');
      expect(result[0].enabled).toBe(false);
      expect(result[0].selected).toBe(true);
      expect(result[0].variables).toEqual(mockVariables);
    });

    it('should preserve enabled and selected flags for each simulation', () => {
      const mockLoadedSimulations = [
        { name: 'Enabled Selected', enabled: true, selected: true },
        { name: 'Enabled Not Selected', enabled: true, selected: false },
        { name: 'Disabled', enabled: false, selected: false },
      ];

      vi.mocked(load).mockReturnValue(mockLoadedSimulations);
      vi.mocked(loadVariables).mockReturnValue({});

      const result = loadSimulations();

      expect(result[0].enabled).toBe(true);
      expect(result[0].selected).toBe(true);
      expect(result[1].enabled).toBe(true);
      expect(result[1].selected).toBe(false);
      expect(result[2].enabled).toBe(false);
      expect(result[2].selected).toBe(false);
    });

    it('should call loadVariables once per simulation', () => {
      const mockLoadedSimulations = [
        { name: 'Sim A', enabled: true, selected: true },
        { name: 'Sim B', enabled: true, selected: false },
        { name: 'Sim C', enabled: true, selected: false },
      ];

      vi.mocked(load).mockReturnValue(mockLoadedSimulations);
      vi.mocked(loadVariables).mockReturnValue({});

      loadSimulations();

      expect(loadVariables).toHaveBeenCalledTimes(3);
    });

    it('should propagate errors thrown by the io load function', () => {
      vi.mocked(load).mockImplementation(() => {
        throw new Error('simulations.json not found');
      });

      expect(() => loadSimulations()).toThrow('simulations.json not found');
    });

    it('should propagate errors thrown by loadVariables', () => {
      const mockLoadedSimulations = [{ name: 'Broken Scenario', enabled: true, selected: true }];

      vi.mocked(load).mockReturnValue(mockLoadedSimulations);
      vi.mocked(loadVariables).mockImplementation(() => {
        throw new Error('variables.csv parse error');
      });

      expect(() => loadSimulations()).toThrow('variables.csv parse error');
    });
  });

  describe('loadSimulations', () => {
    it('should preserve rateOverrides and systemVariableOverrides from loaded data', () => {
      const mockLoadedSimulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          rateOverrides: { INFLATION: 0.04 },
          systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' },
        },
      ];
      const mockVariables = { rate: { type: 'amount' as const, value: 0.03 } };

      vi.mocked(load).mockReturnValue(mockLoadedSimulations);
      vi.mocked(loadVariables).mockReturnValue(mockVariables);

      const result = loadSimulations();

      expect(result[0].rateOverrides).toEqual({ INFLATION: 0.04 });
      expect(result[0].systemVariableOverrides).toEqual({ JAKE_RETIRE_DATE: '2060-01-01' });
    });
  });

  describe('saveSimulations', () => {
    it('should save variables and metadata, then reset cache', () => {
      const simulations = [
        {
          name: 'Base Scenario',
          enabled: true,
          selected: true,
          variables: { retirementDate: { type: 'date' as const, value: '2030-01-01' as const } },
        },
      ];

      saveSimulations(simulations);

      expect(saveVariables).toHaveBeenCalledWith(simulations);
      expect(save).toHaveBeenCalledWith(
        [{ name: 'Base Scenario', enabled: true, selected: true }],
        'simulations.json',
      );
      expect(resetCache).toHaveBeenCalled();
    });

    it('should strip variables before saving to simulations.json', () => {
      const simulations = [
        {
          name: 'Scenario A',
          enabled: true,
          selected: false,
          variables: { initialBalance: { type: 'amount' as const, value: 200000 } },
        },
        {
          name: 'Scenario B',
          enabled: false,
          selected: true,
          variables: { initialBalance: { type: 'amount' as const, value: 50000 } },
        },
      ];

      saveSimulations(simulations);

      expect(save).toHaveBeenCalledWith(
        [
          { name: 'Scenario A', enabled: true, selected: false },
          { name: 'Scenario B', enabled: false, selected: true },
        ],
        'simulations.json',
      );
    });

    it('should call saveVariables with the full simulations array', () => {
      const simulations = [
        {
          name: 'Full Scenario',
          enabled: true,
          selected: true,
          variables: { rate: { type: 'amount' as const, value: 0.05 } },
        },
      ];

      saveSimulations(simulations);

      expect(saveVariables).toHaveBeenCalledWith(simulations);
    });

    it('should save an empty array of simulations', () => {
      saveSimulations([]);

      expect(saveVariables).toHaveBeenCalledWith([]);
      expect(save).toHaveBeenCalledWith([], 'simulations.json');
      expect(resetCache).toHaveBeenCalled();
    });

    it('should always call resetCache after saving', () => {
      const simulations = [
        {
          name: 'Any Scenario',
          enabled: true,
          selected: true,
          variables: {},
        },
      ];

      saveSimulations(simulations);

      expect(resetCache).toHaveBeenCalledTimes(1);
    });

    it('should call saveVariables before save', () => {
      const callOrder: string[] = [];

      vi.mocked(saveVariables).mockImplementation(() => {
        callOrder.push('saveVariables');
      });
      vi.mocked(save).mockImplementation(() => {
        callOrder.push('save');
      });
      vi.mocked(resetCache).mockImplementation(() => {
        callOrder.push('resetCache');
      });

      saveSimulations([{ name: 'Order Test', enabled: true, selected: true, variables: {} }]);

      expect(callOrder).toEqual(['saveVariables', 'save', 'resetCache']);
    });

    it('should propagate errors thrown by saveVariables', () => {
      vi.mocked(saveVariables).mockImplementation(() => {
        throw new Error('CSV write error');
      });

      expect(() =>
        saveSimulations([{ name: 'Scenario', enabled: true, selected: true, variables: {} }]),
      ).toThrow('CSV write error');
    });

    it('should propagate errors thrown by save', () => {
      vi.mocked(save).mockImplementation(() => {
        throw new Error('Permission denied');
      });

      expect(() =>
        saveSimulations([{ name: 'Scenario', enabled: true, selected: true, variables: {} }]),
      ).toThrow('Permission denied');
    });

    it('should persist rateOverrides and systemVariableOverrides to simulations.json', () => {
      const simulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          variables: {},
          rateOverrides: { INFLATION: 0.04 },
          systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' },
        },
      ];

      saveSimulations(simulations);

      expect(save).toHaveBeenCalledWith(
        [
          {
            name: 'Default',
            enabled: true,
            selected: true,
            rateOverrides: { INFLATION: 0.04 },
            systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' },
          },
        ],
        'simulations.json',
      );
    });

    it('should not include override keys when simulation has no overrides', () => {
      const simulations = [
        {
          name: 'Default',
          enabled: true,
          selected: true,
          variables: {},
        },
      ];

      saveSimulations(simulations);

      const savedData = vi.mocked(save).mock.calls[0][0] as any[];
      expect(savedData[0]).not.toHaveProperty('rateOverrides');
      expect(savedData[0]).not.toHaveProperty('systemVariableOverrides');
    });
  });

  describe('getSimulationOverrides', () => {
    it('should return overrides when present', () => {
      vi.mocked(load).mockReturnValue([
        {
          name: 'Default',
          enabled: true,
          selected: true,
          rateOverrides: { INFLATION: 0.04 },
          systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' },
        },
      ]);

      const result = getSimulationOverrides('Default');
      expect(result).toEqual({
        rateOverrides: { INFLATION: 0.04 },
        systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-01-01' },
      });
    });

    it('should return null when simulation has no overrides', () => {
      vi.mocked(load).mockReturnValue([
        { name: 'Default', enabled: true, selected: true },
      ]);

      const result = getSimulationOverrides('Default');
      expect(result).toBeNull();
    });

    it('should return null when simulation not found', () => {
      vi.mocked(load).mockReturnValue([]);

      const result = getSimulationOverrides('Missing');
      expect(result).toBeNull();
    });
  });
});
