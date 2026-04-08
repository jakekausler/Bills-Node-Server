import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSystemVariables, resolveSystemVariable, isSystemVariable } from './system-variables';

vi.mock('../person-config/person-config', () => ({
  getPersonNames: vi.fn(() => ['Jake', 'Kendall']),
  getPersonRetirementDate: vi.fn((name: string) => {
    if (name === 'Jake') return new Date('2055-07-01');
    if (name === 'Kendall') return new Date('2058-03-15');
    throw new Error(`Unknown person: ${name}`);
  }),
  getPersonSSStartDate: vi.fn((name: string) => {
    if (name === 'Jake') return new Date('2062-01-01');
    if (name === 'Kendall') return new Date('2065-06-01');
    throw new Error(`Unknown person: ${name}`);
  }),
}));

describe('getSystemVariables', () => {
  it('returns 4 variables (2 per person)', () => {
    expect(getSystemVariables()).toHaveLength(4);
  });

  it('returns correctly formatted variable names', () => {
    const names = getSystemVariables().map(v => v.name);
    expect(names).toContain('JAKE_RETIRE_DATE');
    expect(names).toContain('JAKE_SS_START_DATE');
    expect(names).toContain('KENDALL_RETIRE_DATE');
    expect(names).toContain('KENDALL_SS_START_DATE');
  });
});

describe('resolveSystemVariable', () => {
  it('returns Jake retirement date for JAKE_RETIRE_DATE', () => {
    expect(resolveSystemVariable('JAKE_RETIRE_DATE')).toEqual(new Date('2055-07-01'));
  });

  it('returns Kendall SS start date for KENDALL_SS_START_DATE', () => {
    expect(resolveSystemVariable('KENDALL_SS_START_DATE')).toEqual(new Date('2065-06-01'));
  });

  it('returns null for unknown person suffix', () => {
    expect(resolveSystemVariable('UNKNOWN_RETIRE_DATE')).toBeNull();
  });

  it('returns null for non-system variable name', () => {
    expect(resolveSystemVariable('INFLATION')).toBeNull();
  });

  it('returns null for wrong suffix', () => {
    expect(resolveSystemVariable('JAKE_SOMETHING')).toBeNull();
  });
});

describe('isSystemVariable', () => {
  it('returns true for known system variable', () => {
    expect(isSystemVariable('JAKE_RETIRE_DATE')).toBe(true);
  });

  it('returns false for non-system variable', () => {
    expect(isSystemVariable('INFLATION')).toBe(false);
  });

  it('returns false for unknown person', () => {
    expect(isSystemVariable('UNKNOWN_RETIRE_DATE')).toBe(false);
  });

  it('returns false for lowercase person name', () => {
    expect(isSystemVariable('jake_RETIRE_DATE')).toBe(false);
  });
});
