import { describe, it, expect, vi } from 'vitest';
import { loadVariableValue, loadDateOrVariable, loadNumberOrVariable } from './loadVariableValue';
import { loadVariable } from './variable';

// Mock dependencies
vi.mock('./variable', () => ({
  loadVariable: vi.fn(),
}));

describe('loadVariableValue', () => {
  it('should parse valid date strings', () => {
    const result = loadVariableValue('2024-01-01');
    
    expect(result.type).toBe('date');
    expect(result.value).toEqual(new Date('2024-01-01'));
  });

  it('should parse valid numbers', () => {
    const result = loadVariableValue('123.45');
    
    expect(result.type).toBe('amount');
    expect(result.value).toBe(123.45);
  });

  it('should parse integers', () => {
    const result = loadVariableValue('100');
    
    expect(result.type).toBe('amount');
    expect(result.value).toBe(100);
  });

  it('should parse negative numbers', () => {
    const result = loadVariableValue('-50.25');
    
    expect(result.type).toBe('amount');
    expect(result.value).toBe(-50.25);
  });

  it('should parse non-standard date formats correctly', () => {
    const result = loadVariableValue('2024/01/01');
    
    // Now with the fixed logic, it should correctly parse as a date
    expect(result.type).toBe('date');
    expect(result.value).toEqual(new Date('2024/01/01'));
  });

  it('should throw error for invalid values', () => {
    expect(() => loadVariableValue('invalid-value')).toThrow("Invalid value 'invalid-value'");
  });
});

describe('loadDateOrVariable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse valid date string when not variable', () => {
    const result = loadDateOrVariable('2024-01-01', false, null, 'Default');
    
    expect(result.date).toEqual(new Date('2024-01-01'));
    expect(result.dateIsVariable).toBe(false);
    expect(result.dateVariable).toBeNull();
    expect(loadVariable).not.toHaveBeenCalled();
  });

  it('should load variable value when dateIsVariable is true', () => {
    const mockDate = new Date('2024-06-15');
    vi.mocked(loadVariable).mockReturnValue(mockDate);
    
    const result = loadDateOrVariable('2024-01-01', true, 'START_DATE', 'Default');
    
    expect(result.date).toBe(mockDate);
    expect(result.dateIsVariable).toBe(true);
    expect(result.dateVariable).toBe('START_DATE');
    expect(loadVariable).toHaveBeenCalledWith('START_DATE', 'Default');
  });

  it('should load variable when date parsing fails', () => {
    const mockDate = new Date('2024-06-15');
    vi.mocked(loadVariable).mockReturnValue(mockDate);
    
    const result = loadDateOrVariable('invalid-date', false, 'START_DATE', 'Default');
    
    expect(result.date).toBe(mockDate);
    expect(result.dateIsVariable).toBe(true);
    expect(result.dateVariable).toBe('START_DATE');
    expect(loadVariable).toHaveBeenCalledWith('START_DATE', 'Default');
  });

  it('should return parsed date when dateIsVariable is false and parsing succeeds', () => {
    const result = loadDateOrVariable('2024-12-31', false, 'START_DATE', 'Default');
    
    expect(result.date).toEqual(new Date('2024-12-31'));
    expect(result.dateIsVariable).toBe(false);
    expect(result.dateVariable).toBe('START_DATE');
    expect(loadVariable).not.toHaveBeenCalled();
  });

  it('should throw error when dateVariable is null and date is invalid', () => {
    expect(() => loadDateOrVariable('invalid-date', false, null, 'Default')).toThrow("Invalid date 'invalid-date'");
  });
});

describe('loadNumberOrVariable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should parse valid number when not variable', () => {
    const result = loadNumberOrVariable(100, false, null, 'Default');
    
    expect(result.amount).toBe(100);
    expect(result.amountIsVariable).toBe(false);
    expect(result.amountVariable).toBeNull();
    expect(loadVariable).not.toHaveBeenCalled();
  });

  it('should parse string number when not variable', () => {
    const result = loadNumberOrVariable('123.45', false, null, 'Default');
    
    expect(result.amount).toBe(123.45);
    expect(result.amountIsVariable).toBe(false);
    expect(result.amountVariable).toBeNull();
    expect(loadVariable).not.toHaveBeenCalled();
  });

  it('should load variable value when amountIsVariable is true', () => {
    const mockAmount = 250.75;
    vi.mocked(loadVariable).mockReturnValue(mockAmount);
    
    const result = loadNumberOrVariable(100, true, 'SALARY', 'Default');
    
    expect(result.amount).toBe(mockAmount);
    expect(result.amountIsVariable).toBe(true);
    expect(result.amountVariable).toBe('SALARY');
    expect(loadVariable).toHaveBeenCalledWith('SALARY', 'Default');
  });

  it('should handle special fraction values', () => {
    const result = loadNumberOrVariable('{HALF}', false, null, 'Default');
    
    expect(result.amount).toBe('{HALF}');
    expect(result.amountIsVariable).toBe(false);
    expect(result.amountVariable).toBeNull();
  });

  it('should handle negative fraction values', () => {
    const result = loadNumberOrVariable('-{FULL}', false, null, 'Default');
    
    expect(result.amount).toBe('-{FULL}');
    expect(result.amountIsVariable).toBe(false);
    expect(result.amountVariable).toBeNull();
  });

  it('should load variable when parsing fails and variable is provided', () => {
    const mockAmount = 500;
    vi.mocked(loadVariable).mockReturnValue(mockAmount);
    
    const result = loadNumberOrVariable('invalid-number', false, 'AMOUNT', 'Default');
    
    expect(result.amount).toBe(mockAmount);
    expect(result.amountIsVariable).toBe(true);
    expect(result.amountVariable).toBe('AMOUNT');
    expect(loadVariable).toHaveBeenCalledWith('AMOUNT', 'Default');
  });

  it('should throw error when amountVariable is null and amount is invalid', () => {
    expect(() => loadNumberOrVariable('invalid-number', false, null, 'Default')).toThrow("Invalid amount 'invalid-number'");
  });
});