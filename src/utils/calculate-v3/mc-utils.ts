import type { MCRateGetter } from './types';
import { MonteCarloSampleType } from './types';

/**
 * Compute compound MC inflation multiplier from baseYear to targetYear.
 * When mcRateGetter is provided, uses per-year MC draws of the specified sampleType.
 * Otherwise, uses a single fixed rate for all years (deterministic mode).
 *
 * @param baseYear     - The year from which to start compounding (exclusive)
 * @param targetYear   - The year to compound to (inclusive)
 * @param fixedRate    - Fallback rate when MC is not active or returns null
 * @param mcRateGetter - MC rate getter (null in deterministic mode)
 * @param sampleType   - Which MC sample type to draw (e.g., INFLATION, HEALTHCARE_INFLATION)
 * @returns The compound multiplier (e.g., 1.1025 for two years at 5%)
 */
export function compoundMCInflation(
  baseYear: number,
  targetYear: number,
  fixedRate: number,
  mcRateGetter: MCRateGetter | null,
  sampleType: MonteCarloSampleType,
): number {
  if (targetYear <= baseYear) return 1;

  if (mcRateGetter) {
    let multiplier = 1;
    for (let y = baseYear + 1; y <= targetYear; y++) {
      const mcRate = mcRateGetter(sampleType, y);
      const rate = mcRate !== null ? mcRate : fixedRate;
      multiplier *= (1 + rate);
    }
    return multiplier;
  }

  return Math.pow(1 + fixedRate, targetYear - baseYear);
}
