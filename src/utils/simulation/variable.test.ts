import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadVariable } from './variable';
import { loadSimulations, getSimulationOverrides } from '../io/simulation';
import { resolveSystemVariable } from '../../api/system-variables/system-variables';
import { isRate, getRate } from '../../api/rates-config/rates-config';

// Project test conventions:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for module-level dependencies
// - Async: synchronous function, no async needed
// - Assertions: expect().toBe() / expect().toEqual() / expect().toThrow()

vi.mock('../io/simulation', () => ({
  loadSimulations: vi.fn(),
  getSimulationOverrides: vi.fn(() => null),
}));

vi.mock('../../api/system-variables/system-variables', () => ({
  resolveSystemVariable: vi.fn(() => null),
}));

vi.mock('../../api/rates-config/rates-config', () => ({
  isRate: vi.fn(() => false),
  getRate: vi.fn(),
}));

const mockLoadSimulations = vi.mocked(loadSimulations);
const mockGetSimulationOverrides = vi.mocked(getSimulationOverrides);
const mockResolveSystemVariable = vi.mocked(resolveSystemVariable);
const mockIsRate = vi.mocked(isRate);
const mockGetRate = vi.mocked(getRate);

describe('loadVariable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: system returns null, isRate returns false, no overrides
    mockGetSimulationOverrides.mockReturnValue(null);
    mockResolveSystemVariable.mockReturnValue(null);
    mockIsRate.mockReturnValue(false);
  });

  // ---------------------------------------------------------------------------
  // Special fraction values (pass-through without variable lookup)
  // ---------------------------------------------------------------------------

  it('should return {HALF} directly without looking up variable', () => {
    const result = loadVariable('{HALF}', 'Default');
    expect(result).toBe('{HALF}');
    // Should not call any source
    expect(mockResolveSystemVariable).not.toHaveBeenCalled();
    expect(mockIsRate).not.toHaveBeenCalled();
    expect(mockLoadSimulations).not.toHaveBeenCalled();
  });

  it('should return {FULL} directly without looking up variable', () => {
    const result = loadVariable('{FULL}', 'Default');
    expect(result).toBe('{FULL}');
  });

  it('should return -{HALF} directly without looking up variable', () => {
    const result = loadVariable('-{HALF}', 'Default');
    expect(result).toBe('-{HALF}');
  });

  it('should return -{FULL} directly without looking up variable', () => {
    const result = loadVariable('-{FULL}', 'Default');
    expect(result).toBe('-{FULL}');
  });

  it('should trim whitespace from variable name before checking special values', () => {
    const result = loadVariable('  {HALF}  ', 'Default');
    expect(result).toBe('{HALF}');
  });

  // ---------------------------------------------------------------------------
  // System variables (source 1 — highest priority)
  // ---------------------------------------------------------------------------

  it('should resolve system variable when resolveSystemVariable returns a Date', () => {
    const date = new Date('2055-07-15T12:00:00.000Z');
    mockResolveSystemVariable.mockReturnValue(date);

    const result = loadVariable('JAKE_RETIRE_DATE', 'Default');
    expect(result).toBe(date);
    expect(mockResolveSystemVariable).toHaveBeenCalledWith('JAKE_RETIRE_DATE');
    // Should not fall through to rates or user vars
    expect(mockIsRate).not.toHaveBeenCalled();
    expect(mockLoadSimulations).not.toHaveBeenCalled();
  });

  it('should prefer system variable over user variable with same name', () => {
    const systemDate = new Date('2055-07-15T12:00:00.000Z');
    mockResolveSystemVariable.mockReturnValue(systemDate);
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          JAKE_RETIRE_DATE: { type: 'date', value: '2060-01-01' },
        },
      },
    ]);

    const result = loadVariable('JAKE_RETIRE_DATE', 'Default');
    expect(result).toBe(systemDate);
    expect(mockLoadSimulations).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Rate variables (source 2)
  // ---------------------------------------------------------------------------

  it('should resolve rate variable when isRate returns true', () => {
    mockIsRate.mockReturnValue(true);
    mockGetRate.mockReturnValue(0.03);

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.03);
    expect(mockIsRate).toHaveBeenCalledWith('INFLATION');
    expect(mockGetRate).toHaveBeenCalledWith('INFLATION');
    // Should not fall through to user vars
    expect(mockLoadSimulations).not.toHaveBeenCalled();
  });

  it('should prefer rate variable over user variable with same name', () => {
    mockIsRate.mockReturnValue(true);
    mockGetRate.mockReturnValue(0.05);
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          INFLATION: { type: 'amount', value: 0.99 },
        },
      },
    ]);

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.05);
    expect(mockLoadSimulations).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // User variables (source 3 — lowest priority)
  // ---------------------------------------------------------------------------

  it('should return numeric value for amount variable with number value', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          SALARY: { type: 'amount', value: 5000 },
        },
      },
    ]);

    const result = loadVariable('SALARY', 'Default');
    expect(result).toBe(5000);
  });

  it('should parse string to number for amount variable with string value', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          JAKE_SPENDING: { type: 'amount', value: '100' },
        },
      },
    ]);

    const result = loadVariable('JAKE_SPENDING', 'Default');
    expect(result).toBe(100);
  });

  it('should parse negative string to number for amount variable', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          DEFICIT: { type: 'amount', value: '-1500.50' },
        },
      },
    ]);

    const result = loadVariable('DEFICIT', 'Default');
    expect(result).toBe(-1500.5);
  });

  it('should parse string date for date variable with string value', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          RETIRE_DATE: { type: 'date', value: '2030-01-15' },
        },
      },
    ]);

    const result = loadVariable('RETIRE_DATE', 'Default');
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe('2030-01-15T12:00:00.000Z');
  });

  it('should return Date object directly for date variable with Date value', () => {
    const dateValue = new Date('2025-06-01T12:00:00Z');
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          START_DATE: { type: 'date', value: dateValue },
        },
      },
    ]);

    const result = loadVariable('START_DATE', 'Default');
    expect(result).toBe(dateValue);
  });

  it('should trim whitespace before looking up variable name in simulation', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          SALARY: { type: 'amount', value: 3000 },
        },
      },
    ]);

    const result = loadVariable('  SALARY  ', 'Default');
    expect(result).toBe(3000);
  });

  it('should load from the correct simulation when multiple exist', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Conservative',
        enabled: true,
        selected: false,
        variables: {
          RATE: { type: 'amount', value: 0.04 },
        },
      },
      {
        name: 'Aggressive',
        enabled: true,
        selected: true,
        variables: {
          RATE: { type: 'amount', value: 0.08 },
        },
      },
    ]);

    const conservativeResult = loadVariable('RATE', 'Conservative');
    expect(conservativeResult).toBe(0.04);

    const aggressiveResult = loadVariable('RATE', 'Aggressive');
    expect(aggressiveResult).toBe(0.08);
  });

  // ---------------------------------------------------------------------------
  // Error cases
  // ---------------------------------------------------------------------------

  it('should throw when simulation is not found (user variable path)', () => {
    mockLoadSimulations.mockReturnValue([]);

    expect(() => loadVariable('MY_VAR', 'NonExistent')).toThrow("Simulation 'NonExistent' not found");
  });

  it('should throw when simulation name does not match', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          MY_VAR: { type: 'amount', value: 100 },
        },
      },
    ]);

    expect(() => loadVariable('MY_VAR', 'OtherSim')).toThrow("Simulation 'OtherSim' not found");
  });

  it('should throw when variable is not in simulation variables', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          OTHER_VAR: { type: 'amount', value: 100 },
        },
      },
    ]);

    expect(() => loadVariable('MISSING_VAR', 'Default')).toThrow("Invalid variable 'MISSING_VAR'");
  });

  it('should throw when variable has an invalid type', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {
          BAD_TYPE_VAR: { type: 'unknown' as never, value: 42 },
        },
      },
    ]);

    expect(() => loadVariable('BAD_TYPE_VAR', 'Default')).toThrow("Invalid variable type 'unknown'");
  });

  // ---------------------------------------------------------------------------
  // Per-simulation overrides
  // ---------------------------------------------------------------------------

  it('should return overridden rate value when rateOverrides contains the variable', () => {
    mockGetSimulationOverrides.mockReturnValue({
      rateOverrides: { INFLATION: 0.04 },
    });

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.04);
    expect(mockResolveSystemVariable).not.toHaveBeenCalled();
    expect(mockIsRate).not.toHaveBeenCalled();
    expect(mockLoadSimulations).not.toHaveBeenCalled();
  });

  it('should return overridden system variable date when systemVariableOverrides contains the variable', () => {
    mockGetSimulationOverrides.mockReturnValue({
      systemVariableOverrides: { JAKE_RETIRE_DATE: '2060-06-15' },
    });

    const result = loadVariable('JAKE_RETIRE_DATE', 'Default');
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe('2060-06-15T12:00:00.000Z');
    expect(mockResolveSystemVariable).not.toHaveBeenCalled();
  });

  it('should fall through to normal resolution when variable is not in overrides', () => {
    mockGetSimulationOverrides.mockReturnValue({
      rateOverrides: { OTHER_RATE: 0.05 },
    });
    mockIsRate.mockReturnValue(true);
    mockGetRate.mockReturnValue(0.03);

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.03);
  });

  it('should fall through to normal resolution when simulation has no overrides', () => {
    mockGetSimulationOverrides.mockReturnValue(null);
    mockIsRate.mockReturnValue(true);
    mockGetRate.mockReturnValue(0.03);

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.03);
  });

  it('should prefer override over system variable with same name', () => {
    mockGetSimulationOverrides.mockReturnValue({
      systemVariableOverrides: { JAKE_RETIRE_DATE: '2065-01-01' },
    });
    const systemDate = new Date('2055-07-15T12:00:00.000Z');
    mockResolveSystemVariable.mockReturnValue(systemDate);

    const result = loadVariable('JAKE_RETIRE_DATE', 'Default');
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe('2065-01-01T12:00:00.000Z');
    expect(mockResolveSystemVariable).not.toHaveBeenCalled();
  });

  it('should prefer rate override over rate config with same name', () => {
    mockGetSimulationOverrides.mockReturnValue({
      rateOverrides: { INFLATION: 0.05 },
    });
    mockIsRate.mockReturnValue(true);
    mockGetRate.mockReturnValue(0.03);

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.05);
    expect(mockIsRate).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Resolution order verification
  // ---------------------------------------------------------------------------

  it('should check system first, then rate, then user', () => {
    // All sources return null/false — should reach user vars and throw
    mockLoadSimulations.mockReturnValue([
      { name: 'Default', enabled: true, selected: true, variables: {} },
    ]);

    expect(() => loadVariable('UNKNOWN', 'Default')).toThrow("Invalid variable 'UNKNOWN'");

    // Verify call order
    expect(mockResolveSystemVariable).toHaveBeenCalledWith('UNKNOWN');
    expect(mockIsRate).toHaveBeenCalledWith('UNKNOWN');
    expect(mockLoadSimulations).toHaveBeenCalled();
  });
});
