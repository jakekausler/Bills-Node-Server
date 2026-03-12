import { describe, it, expect } from 'vitest';
import { setVariableValue } from './setVariableValue';

describe('setVariableValue', () => {
  describe('amount type', () => {
    it('should convert string amount to number', () => {
      const result = setVariableValue({
        type: 'amount',
        value: '1500.50',
      });

      expect(result.type).toBe('amount');
      expect(result.value).toBe(1500.50);
    });

    it('should preserve numeric amount value', () => {
      const result = setVariableValue({
        type: 'amount',
        value: 2500,
      });

      expect(result.type).toBe('amount');
      expect(result.value).toBe(2500);
    });

    it('should handle negative string amounts', () => {
      const result = setVariableValue({
        type: 'amount',
        value: '-750.25',
      });

      expect(result.type).toBe('amount');
      expect(result.value).toBe(-750.25);
    });

    it('should handle zero as string', () => {
      const result = setVariableValue({
        type: 'amount',
        value: '0',
      });

      expect(result.type).toBe('amount');
      expect(result.value).toBe(0);
    });

    it('should handle decimal amounts', () => {
      const result = setVariableValue({
        type: 'amount',
        value: '0.05',
      });

      expect(result.type).toBe('amount');
      expect(result.value).toBe(0.05);
    });
  });

  describe('date type', () => {
    it('should parse string date to Date object', () => {
      const result = setVariableValue({
        type: 'date',
        value: '2024-06-15',
      });

      expect(result.type).toBe('date');
      expect(result.value).toBeInstanceOf(Date);
      expect((result.value as Date).getUTCFullYear()).toBe(2024);
      expect((result.value as Date).getUTCMonth()).toBe(5); // June is 5
      expect((result.value as Date).getUTCDate()).toBe(15);
    });

    it('should preserve Date object value', () => {
      const dateValue = new Date(Date.UTC(2025, 11, 25));
      const result = setVariableValue({
        type: 'date',
        value: dateValue,
      });

      expect(result.type).toBe('date');
      expect(result.value).toBe(dateValue);
    });

    it('should handle different date formats', () => {
      const result = setVariableValue({
        type: 'date',
        value: '2023-01-01',
      });

      expect(result.type).toBe('date');
      expect(result.value).toBeInstanceOf(Date);
      expect((result.value as Date).getUTCFullYear()).toBe(2023);
    });
  });

  describe('error handling', () => {
    it('should throw error for invalid type', () => {
      expect(() =>
        setVariableValue({
          type: 'invalid' as any,
          value: 'test',
        })
      ).toThrow('Invalid value type');
    });

    it('should include the problematic value in error message', () => {
      expect(() =>
        setVariableValue({
          type: 'unknown' as any,
          value: 42,
        })
      ).toThrow(/Invalid value type.*unknown/);
    });
  });
});
