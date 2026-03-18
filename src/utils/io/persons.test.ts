import { describe, it, expect } from 'vitest';
import { getPersonConfigs, getPersonNames, getPersonGender } from './persons';

describe('persons', () => {
  describe('getPersonConfigs', () => {
    it('should return person name and gender from ltcConfig', () => {
      const configs = getPersonConfigs();
      expect(configs.length).toBeGreaterThan(0);
      expect(configs[0]).toHaveProperty('personName');
      expect(configs[0]).toHaveProperty('gender');
    });
  });

  describe('getPersonNames', () => {
    it('should return array of person names', () => {
      const names = getPersonNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBeGreaterThan(0);
      expect(typeof names[0]).toBe('string');
    });
  });

  describe('getPersonGender', () => {
    it('should return gender for a known person', () => {
      const configs = getPersonConfigs();
      const firstName = configs[0].personName;
      const gender = getPersonGender(firstName);
      expect(['male', 'female']).toContain(gender);
    });

    it('should throw for unknown person', () => {
      expect(() => getPersonGender('UnknownPerson')).toThrow();
    });
  });
});
