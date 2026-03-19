/**
 * Shadow calculator for contribution limits.
 * Independent reimplementation — does NOT import from engine code.
 *
 * Mirrors the logic in calculate-v3/contribution-limit-manager.ts:
 *   - Historical limits from contributionLimits data
 *   - Fallback 2.5% annual inflation from 2024 base limits
 *   - Age-based catch-up provisions (50+ for 401k/IRA, 55+ for HSA)
 */

const BASE_LIMITS_2024: Record<string, number> = {
  '401k': 23500,
  ira: 7000,
  hsa_individual: 4150,
  hsa_family: 8300,
};

const CATCHUP_LIMITS_2024: Record<string, number> = {
  '401k': 7500, // Age 50+
  ira: 1000, // Age 50+
  hsa: 1000, // Age 55+
};

const ANNUAL_INFLATION_RATE = 0.025; // 2.5%

/**
 * Inflate a 2024 base amount forward to `targetYear` at 2.5% compound.
 */
function inflateLimitToYear(baseLimit: number, targetYear: number): number {
  const yearsDiff = targetYear - 2024;
  if (yearsDiff <= 0) return baseLimit;
  return Math.round(baseLimit * Math.pow(1 + ANNUAL_INFLATION_RATE, yearsDiff));
}

/**
 * Look up a historical base limit (before catch-up) for the given type and year.
 * Returns null when the year is not present in the data.
 */
function getHistoricalLimit(
  limitType: '401k' | 'ira' | 'hsa',
  year: number,
  contributionLimits: Record<string, any>,
): number | null {
  const yearStr = String(year);
  const bucket = contributionLimits[limitType];
  if (bucket && bucket[yearStr] !== undefined) {
    return bucket[yearStr] as number;
  }
  return null;
}

/**
 * Compute the catch-up addition for a given limit type, age, and year.
 * Catch-up amounts are inflated from their 2024 base values.
 */
function getCatchUp(limitType: '401k' | 'ira' | 'hsa', age: number, year: number): number {
  if (limitType === '401k' && age >= 50) {
    return inflateLimitToYear(CATCHUP_LIMITS_2024['401k'], year);
  }
  if (limitType === 'ira' && age >= 50) {
    return inflateLimitToYear(CATCHUP_LIMITS_2024['ira'], year);
  }
  if (limitType === 'hsa' && age >= 55) {
    return inflateLimitToYear(CATCHUP_LIMITS_2024['hsa'], year);
  }
  return 0;
}

/**
 * Get the annual contribution limit for a given type, age, and year.
 *
 * Resolution order:
 *   1. Historical limit from contributionLimits data (base only, catch-up added separately)
 *   2. Fallback: inflate the 2024 base limit at 2.5% compound
 *
 * @param limitType  - '401k' | 'ira' | 'hsa'
 * @param age        - Person's age at end of the given year
 * @param year       - Calendar year
 * @param contributionLimits - The contributionLimits section from historicRates.json
 */
export function getAnnualLimit(
  limitType: '401k' | 'ira' | 'hsa',
  age: number,
  year: number,
  contributionLimits: Record<string, any>,
): number {
  // Try historical data first
  const historical = getHistoricalLimit(limitType, year, contributionLimits);

  let baseLimit: number;
  if (historical !== null) {
    baseLimit = historical;
  } else {
    // Fallback: inflate 2024 base limit
    if (limitType === 'hsa') {
      baseLimit = inflateLimitToYear(BASE_LIMITS_2024['hsa_individual'], year);
    } else {
      baseLimit = inflateLimitToYear(BASE_LIMITS_2024[limitType], year);
    }
  }

  // Add age-based catch-up
  return baseLimit + getCatchUp(limitType, age, year);
}

/**
 * Compute how much contribution room remains for the year.
 *
 * @param ytdContributions   - Amount already contributed year-to-date
 * @param limitType          - '401k' | 'ira' | 'hsa'
 * @param age                - Person's age at end of the given year
 * @param year               - Calendar year
 * @param contributionLimits - The contributionLimits section from historicRates.json
 */
export function getRemainingLimit(
  ytdContributions: number,
  limitType: '401k' | 'ira' | 'hsa',
  age: number,
  year: number,
  contributionLimits: Record<string, any>,
): number {
  return Math.max(0, getAnnualLimit(limitType, age, year, contributionLimits) - ytdContributions);
}
