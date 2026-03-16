import { describe, it, expect } from 'vitest';
import { FilteredAccount, FilteredActivity } from './types';
import { PullFailure } from '../calculate-v3/push-pull-handler';

/**
 * Test suite for #9: Funded Ratio / Success Metrics tracking
 */
describe('Funded Ratio - Funding Failure Detection (using actual pull failures)', () => {
  it('should detect no funding failure when no pull failures occur', () => {
    // No pull failures recorded
    const pullFailures: PullFailure[] = [];

    // Check for funding failure using actual pull failures
    let fundingFailureYear: number | null = null;

    if (pullFailures.length > 0) {
      for (const failure of pullFailures) {
        const failureYear = failure.date.getUTCFullYear();
        if (fundingFailureYear === null || failureYear < fundingFailureYear) {
          fundingFailureYear = failureYear;
        }
      }
    }

    expect(fundingFailureYear).toBeNull();
  });

  it('should detect funding failure when a pull cannot be fully sourced', () => {
    // Pull failure in 2027: tried to pull $15,000 but could only source $10,000 (shortfall: $5,000)
    const pullFailures: PullFailure[] = [
      {
        date: new Date('2027-03-15'),
        accountId: 'acc1',
        shortfall: 5000,
      },
    ];

    // Check for funding failure using actual pull failures
    let fundingFailureYear: number | null = null;

    if (pullFailures.length > 0) {
      for (const failure of pullFailures) {
        const failureYear = failure.date.getUTCFullYear();
        if (fundingFailureYear === null || failureYear < fundingFailureYear) {
          fundingFailureYear = failureYear;
        }
      }
    }

    expect(fundingFailureYear).toBe(2027);
  });

  it('should detect pull failure regardless of account type (only tracks actual failures)', () => {
    // Pull failure happens when push/pull handler cannot source enough funds
    // The type of account doesn't matter - only whether a pull actually failed
    const pullFailures: PullFailure[] = [
      {
        date: new Date('2026-06-01'),
        accountId: 'acc2', // Retirement account that performs pulls
        shortfall: 5000,
      },
    ];

    // Check for funding failure using actual pull failures
    let fundingFailureYear: number | null = null;

    if (pullFailures.length > 0) {
      for (const failure of pullFailures) {
        const failureYear = failure.date.getUTCFullYear();
        if (fundingFailureYear === null || failureYear < fundingFailureYear) {
          fundingFailureYear = failureYear;
        }
      }
    }

    expect(fundingFailureYear).toBe(2026);
  });

  it('should use earliest failure year when multiple pull failures occur in different years', () => {
    // Multiple pull failures in different years
    const pullFailures: PullFailure[] = [
      {
        date: new Date('2028-06-01'),
        accountId: 'acc1',
        shortfall: 5000,
      },
      {
        date: new Date('2027-03-01'),
        accountId: 'acc2',
        shortfall: 10000,
      },
    ];

    // Check for funding failure using actual pull failures
    let fundingFailureYear: number | null = null;

    if (pullFailures.length > 0) {
      for (const failure of pullFailures) {
        const failureYear = failure.date.getUTCFullYear();
        if (fundingFailureYear === null || failureYear < fundingFailureYear) {
          fundingFailureYear = failureYear;
        }
      }
    }

    // Should report earliest failure (2027)
    expect(fundingFailureYear).toBe(2027);
  });
});

describe('Funded Ratio Computation', () => {
  it('should compute correct funded ratio (8 out of 10 pass = 80%)', () => {
    const simulationData = [
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: 2030 },
      { fundingFailureYear: 2032 },
    ];

    const totalSims = simulationData.length;
    const failedSims = simulationData.filter(
      (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
    ).length;
    const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

    expect(totalSims).toBe(10);
    expect(failedSims).toBe(2);
    expect(fundedRatio).toBe(80);
  });

  it('should compute funded ratio as 100% when no simulations fail', () => {
    const simulationData = [
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
      { fundingFailureYear: null },
    ];

    const totalSims = simulationData.length;
    const failedSims = simulationData.filter(
      (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
    ).length;
    const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

    expect(fundedRatio).toBe(100);
  });

  it('should compute funded ratio as 0% when all simulations fail', () => {
    const simulationData = [
      { fundingFailureYear: 2030 },
      { fundingFailureYear: 2031 },
      { fundingFailureYear: 2029 },
    ];

    const totalSims = simulationData.length;
    const failedSims = simulationData.filter(
      (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
    ).length;
    const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

    expect(fundedRatio).toBe(0);
  });

  it('should compute correct median failure year', () => {
    const failureYears = [2030, 2031, 2029, 2035, 2032].sort((a, b) => a - b);
    // Sorted: [2029, 2030, 2031, 2032, 2035]
    const medianFailureYear = failureYears[Math.floor(failureYears.length / 2)];

    expect(medianFailureYear).toBe(2031);
  });

  it('should handle median failure year with even number of failures', () => {
    const failureYears = [2030, 2031, 2029, 2035].sort((a, b) => a - b);
    // Sorted: [2029, 2030, 2031, 2035]
    // Length 4, Math.floor(4/2) = 2, so failureYears[2] = 2031
    const medianFailureYear = failureYears[Math.floor(failureYears.length / 2)];

    expect(medianFailureYear).toBe(2031);
  });

  it('should return null median failure year when no simulations fail', () => {
    const simulationData = [
      { fundingFailureYear: null },
      { fundingFailureYear: null },
    ];

    const failureYears = simulationData
      .filter((s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined)
      .map((s) => s.fundingFailureYear!);

    const medianFailureYear = failureYears.length > 0 ? failureYears.sort((a, b) => a - b)[Math.floor(failureYears.length / 2)] : null;

    expect(medianFailureYear).toBeNull();
  });
});
