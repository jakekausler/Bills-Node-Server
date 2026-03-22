import { describe, it, expect } from 'vitest';
import { getAnnualDeathProbability } from './ssa-mortality';

const testLifeTable: Record<string, Record<string, number>> = {
  male: { '0': 0.006064, '30': 0.001676, '80': 0.065407, '119': 1.0 },
  female: { '0': 0.005028, '30': 0.000726, '80': 0.043232, '119': 1.0 },
};

describe('getAnnualDeathProbability', () => {
  it('returns correct probability for a 30-year-old male', () => {
    expect(getAnnualDeathProbability(30, 'male', testLifeTable)).toBe(0.001676);
  });

  it('returns correct probability for an 80-year-old female', () => {
    expect(getAnnualDeathProbability(80, 'female', testLifeTable)).toBe(0.043232);
  });

  it('clamps age to 119 for very old ages', () => {
    expect(getAnnualDeathProbability(125, 'male', testLifeTable)).toBe(1.0);
  });

  it('floors fractional ages', () => {
    expect(getAnnualDeathProbability(30.7, 'male', testLifeTable)).toBe(0.001676);
  });

  it('returns 0 for missing age key', () => {
    expect(getAnnualDeathProbability(50, 'male', testLifeTable)).toBe(0);
  });
});
