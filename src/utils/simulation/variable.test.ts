import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadVariable } from './variable';
import { loadSimulations } from '../io/simulation';

// Project test conventions:
// - Framework: Vitest with vi.mock()
// - Mocking: vi.mock() for module-level dependencies
// - Async: synchronous function, no async needed
// - Assertions: expect().toBe() / expect().toEqual() / expect().toThrow()

vi.mock('../io/simulation', () => ({
  loadSimulations: vi.fn(),
}));

const mockLoadSimulations = vi.mocked(loadSimulations);

describe('loadVariable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Simulation not found
  // ---------------------------------------------------------------------------

  it('should throw when simulation is not found', () => {
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

  // ---------------------------------------------------------------------------
  // Special fraction values (pass-through without variable lookup)
  // ---------------------------------------------------------------------------

  it('should return {HALF} directly without looking up variable', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {},
      },
    ]);

    const result = loadVariable('{HALF}', 'Default');
    expect(result).toBe('{HALF}');
  });

  it('should return {FULL} directly without looking up variable', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {},
      },
    ]);

    const result = loadVariable('{FULL}', 'Default');
    expect(result).toBe('{FULL}');
  });

  it('should return -{HALF} directly without looking up variable', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {},
      },
    ]);

    const result = loadVariable('-{HALF}', 'Default');
    expect(result).toBe('-{HALF}');
  });

  it('should return -{FULL} directly without looking up variable', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {},
      },
    ]);

    const result = loadVariable('-{FULL}', 'Default');
    expect(result).toBe('-{FULL}');
  });

  it('should trim whitespace from variable name before checking special values', () => {
    mockLoadSimulations.mockReturnValue([
      {
        name: 'Default',
        enabled: true,
        selected: true,
        variables: {},
      },
    ]);

    const result = loadVariable('  {HALF}  ', 'Default');
    expect(result).toBe('{HALF}');
  });

  // ---------------------------------------------------------------------------
  // Amount variables
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
          INFLATION: { type: 'amount', value: '0.03' },
        },
      },
    ]);

    const result = loadVariable('INFLATION', 'Default');
    expect(result).toBe(0.03);
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

  // ---------------------------------------------------------------------------
  // Date variables
  // ---------------------------------------------------------------------------

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
    // parseDate adds T12:00:00Z
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

  // ---------------------------------------------------------------------------
  // Variable not found in simulation
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Invalid variable type
  // ---------------------------------------------------------------------------

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
  // Multiple simulations
  // ---------------------------------------------------------------------------

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
});
