import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compoundMCInflation } from './mc-utils';
import { MonteCarloSampleType, MCRateGetter } from './types';
import { AcaManager } from './aca-manager';
import { LTCManager } from './ltc-manager';

// Mock IO for AcaManager
vi.mock('../../utils/io/io', () => ({
  load: (filename: string) => {
    if (filename === 'historicRates.json') {
      return {
        acaBenchmarkPremium: { '2026': 700.0 },
        acaAgeCurve: { '40': 1.278, '50': 1.56 },
        fpl: { '2026': { firstPerson: 15960.0, additionalPerson: 5680.0 } },
        employerPremium: { '2026': 1124.32 },
        acaOutOfPocketMax: { '2026': { individual: 10600, family: 21200 } },
      };
    }
    return {};
  },
}));

describe('compoundMCInflation', () => {
  it('returns 1 when targetYear <= baseYear', () => {
    expect(compoundMCInflation(2024, 2024, 0.05, null, MonteCarloSampleType.INFLATION)).toBe(1);
    expect(compoundMCInflation(2024, 2020, 0.05, null, MonteCarloSampleType.INFLATION)).toBe(1);
  });

  it('uses fixed rate in deterministic mode (no mcRateGetter)', () => {
    const result = compoundMCInflation(2024, 2026, 0.05, null, MonteCarloSampleType.INFLATION);
    // (1.05)^2 = 1.1025
    expect(result).toBeCloseTo(1.1025, 6);
  });

  it('uses per-year MC draws when mcRateGetter is provided', () => {
    // Return known per-year values: 2025 -> 3%, 2026 -> 7%
    const mockGetter: MCRateGetter = (type, year) => {
      if (year === 2025) return 0.03;
      if (year === 2026) return 0.07;
      return null;
    };
    const result = compoundMCInflation(2024, 2026, 0.05, mockGetter, MonteCarloSampleType.INFLATION);
    // 1.03 * 1.07 = 1.1021
    expect(result).toBeCloseTo(1.1021, 4);
  });

  it('falls back to fixedRate when mcRateGetter returns null', () => {
    const mockGetter: MCRateGetter = (_type, _year) => null;
    const result = compoundMCInflation(2024, 2026, 0.05, mockGetter, MonteCarloSampleType.INFLATION);
    // Falls back to fixedRate: (1.05)^2 = 1.1025
    expect(result).toBeCloseTo(1.1025, 6);
  });

  it('handles mixed MC and fallback rates', () => {
    // 2025 -> MC returns 0.02, 2026 -> MC returns null (fallback to 0.05)
    const mockGetter: MCRateGetter = (_type, year) => {
      if (year === 2025) return 0.02;
      return null;
    };
    const result = compoundMCInflation(2024, 2026, 0.05, mockGetter, MonteCarloSampleType.INFLATION);
    // 1.02 * 1.05 = 1.071
    expect(result).toBeCloseTo(1.071, 4);
  });

  it('passes the correct sampleType to the getter', () => {
    const calls: { type: MonteCarloSampleType; year: number }[] = [];
    const mockGetter: MCRateGetter = (type, year) => {
      calls.push({ type, year });
      return 0.04;
    };
    compoundMCInflation(2024, 2026, 0.05, mockGetter, MonteCarloSampleType.HEALTHCARE_INFLATION);
    expect(calls).toEqual([
      { type: MonteCarloSampleType.HEALTHCARE_INFLATION, year: 2025 },
      { type: MonteCarloSampleType.HEALTHCARE_INFLATION, year: 2026 },
    ]);
  });
});

describe('AcaManager.getHealthcareInflationRate with MC', () => {
  let manager: AcaManager;

  beforeEach(() => {
    manager = new AcaManager();
  });

  it('returns default 5% when no MC rate getter is set', () => {
    const rate = manager.getHealthcareInflationRate(2030);
    expect(rate).toBe(0.05);
  });

  it('returns MC rate when MC rate getter is set and returns a value', () => {
    const mockGetter: MCRateGetter = (type, _year) => {
      if (type === MonteCarloSampleType.HEALTHCARE_INFLATION) return 0.08;
      return null;
    };
    manager.setMCRateGetter(mockGetter);
    const rate = manager.getHealthcareInflationRate(2030);
    expect(rate).toBe(0.08);
  });

  it('falls back to default when MC rate getter returns null', () => {
    const mockGetter: MCRateGetter = () => null;
    manager.setMCRateGetter(mockGetter);
    const rate = manager.getHealthcareInflationRate(2030);
    expect(rate).toBe(0.05);
  });
});

describe('LTCManager.compoundHealthcareInflation MC vs deterministic', () => {
  let manager: LTCManager;

  beforeEach(() => {
    manager = new LTCManager();
  });

  it('uses fixed 5% rate in deterministic mode', () => {
    // baseYear is 2024 (internal to LTCManager)
    const result = manager.compoundHealthcareInflation(2026);
    // (1.05)^2 = 1.1025
    expect(result).toBeCloseTo(1.1025, 4);
  });

  it('returns 1 when target year <= base year', () => {
    expect(manager.compoundHealthcareInflation(2024)).toBe(1);
    expect(manager.compoundHealthcareInflation(2020)).toBe(1);
  });

  it('uses per-year MC draws when MC rate getter is set', () => {
    const mockGetter: MCRateGetter = (type, year) => {
      if (type === MonteCarloSampleType.HEALTHCARE_INFLATION) {
        if (year === 2025) return 0.04;
        if (year === 2026) return 0.06;
      }
      return null;
    };
    manager.setMCRateGetter(mockGetter);
    const result = manager.compoundHealthcareInflation(2026);
    // 1.04 * 1.06 = 1.1024
    expect(result).toBeCloseTo(1.1024, 4);
  });
});
