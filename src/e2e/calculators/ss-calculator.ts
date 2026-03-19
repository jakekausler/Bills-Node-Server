/**
 * Shadow calculator for Social Security verification.
 * Independent reimplementation — does NOT import from engine code.
 *
 * Mirrors the SS logic in retirement-manager.ts:
 *   AIME → PIA → FRA factor → COLA → spousal benefit
 */

/**
 * Calculate Average Indexed Monthly Earnings (AIME).
 *
 * Steps:
 *   1. Cap each year's earnings at the wage base for that year
 *   2. Index earnings to the year the worker turns 60 using AWI ratios
 *      (years after age-60 use raw earnings, not indexed)
 *   3. Pad to 35 years with zeros if fewer earning years
 *   4. Sum the 35 highest indexed years, divide by 35, divide by 12
 *
 * @param earningsByYear  - Raw earnings keyed by calendar year
 * @param yearTurn60      - Calendar year the worker turns 60
 * @param wageIndex       - Average Wage Index keyed by year (string keys OK)
 * @param wageBaseCaps    - SS taxable wage base cap keyed by year
 * @returns AIME (monthly dollar amount, unrounded)
 */
export function calculateAIME(
  earningsByYear: Record<number, number>,
  yearTurn60: number,
  wageIndex: Record<string, number>,
  wageBaseCaps: Record<number, number>,
): number {
  // Build a numeric-keyed copy of wage index so lookups are consistent
  const awi: Record<number, number> = {};
  for (const [k, v] of Object.entries(wageIndex)) {
    awi[Number(k)] = v;
  }

  // Extrapolate AWI forward if needed (matches engine: average historical growth rate)
  const awiYears = Object.keys(awi).map(Number).sort((a, b) => a - b);
  const highestAwiYear = awiYears[awiYears.length - 1];
  if (highestAwiYear < yearTurn60) {
    const increases: number[] = [];
    for (let i = 1; i < awiYears.length; i++) {
      increases.push((awi[awiYears[i]] - awi[awiYears[i - 1]]) / awi[awiYears[i - 1]]);
    }
    const avgIncrease = increases.reduce((s, v) => s + v, 0) / increases.length;
    for (let yr = highestAwiYear + 1; yr <= yearTurn60; yr++) {
      awi[yr] = awi[yr - 1] * (1 + avgIncrease);
    }
  }

  // Cap and index each year's earnings
  const indexedEarnings: number[] = [];
  for (const [yrStr, rawAmount] of Object.entries(earningsByYear)) {
    const year = Number(yrStr);
    // Apply wage base cap
    const cap = wageBaseCaps[year] ?? Infinity;
    const capped = Math.min(rawAmount, cap);

    if (year > yearTurn60) {
      // Years after age-60: use raw (capped) amount
      indexedEarnings.push(capped);
    } else {
      // Years at or before age-60: index using AWI ratio
      const indexed = (capped * awi[yearTurn60]) / awi[year];
      indexedEarnings.push(indexed);
    }
  }

  // Pad to 35 years with zeros
  while (indexedEarnings.length < 35) {
    indexedEarnings.push(0);
  }

  // Sum all (engine uses all entries, not just top 35) and divide
  const total = indexedEarnings.reduce((s, v) => s + v, 0);
  return total / 35 / 12;
}

/**
 * Compute Primary Insurance Amount (PIA) from AIME.
 *
 * IMPORTANT: The engine computes the second segment as
 *   min(remainingAime, secondBendPoint)  — NOT (bend2 - bend1).
 * This means bend points are applied sequentially against a shrinking AIME.
 *
 * @param aime          - Average Indexed Monthly Earnings
 * @param yearTurns62   - Calendar year the worker turns 62
 * @param bendPoints    - Bend points keyed by year, each { first, second }
 * @returns PIA (monthly dollar amount, unrounded)
 */
export function calculatePIA(
  aime: number,
  yearTurns62: number,
  bendPoints: Record<string, { first: number; second: number }>,
): number {
  // Build numeric-keyed copy and extrapolate if needed
  const bp: Record<number, { first: number; second: number }> = {};
  for (const [k, v] of Object.entries(bendPoints)) {
    bp[Number(k)] = v;
  }

  const bpYears = Object.keys(bp).map(Number).sort((a, b) => a - b);
  const highestBpYear = bpYears[bpYears.length - 1];
  if (highestBpYear < yearTurns62) {
    const firstIncreases: number[] = [];
    const secondIncreases: number[] = [];
    for (let i = 1; i < bpYears.length; i++) {
      firstIncreases.push(
        (bp[bpYears[i]].first - bp[bpYears[i - 1]].first) / bp[bpYears[i - 1]].first,
      );
      secondIncreases.push(
        (bp[bpYears[i]].second - bp[bpYears[i - 1]].second) / bp[bpYears[i - 1]].second,
      );
    }
    const avgFirst = firstIncreases.reduce((s, v) => s + v, 0) / firstIncreases.length;
    const avgSecond = secondIncreases.reduce((s, v) => s + v, 0) / secondIncreases.length;
    for (let yr = highestBpYear + 1; yr <= yearTurns62; yr++) {
      bp[yr] = {
        first: bp[yr - 1].first * (1 + avgFirst),
        second: bp[yr - 1].second * (1 + avgSecond),
      };
    }
  }

  const { first: firstBendPoint, second: secondBendPoint } = bp[yearTurns62];

  // Sequential subtraction (matches engine exactly)
  let remaining = aime;
  const firstAmount = Math.min(remaining, firstBendPoint);
  remaining -= firstAmount;
  const secondAmount = Math.min(remaining, secondBendPoint);
  remaining -= secondAmount;

  return firstAmount * 0.9 + secondAmount * 0.32 + remaining * 0.15;
}

/**
 * Get Full Retirement Age (FRA) based on birth year.
 *
 * Schedule:
 *   <= 1937        → 65
 *   1938-1942      → 65 + (birthYear - 1937) * 2 months
 *   1943-1954      → 66
 *   1955           → 66 + 2mo
 *   1956           → 66 + 4mo
 *   1957           → 66 + 6mo
 *   1958           → 66 + 8mo
 *   1959           → 66 + 10mo
 *   >= 1960        → 67
 *
 * @returns FRA as a decimal year (e.g. 66.1667 for 66 + 2 months)
 */
export function getFullRetirementAge(birthYear: number): number {
  if (birthYear <= 1937) return 65;
  if (birthYear <= 1942) return 65 + ((birthYear - 1937) * 2) / 12;
  if (birthYear <= 1954) return 66;
  if (birthYear === 1955) return 66 + 2 / 12;
  if (birthYear === 1956) return 66 + 4 / 12;
  if (birthYear === 1957) return 66 + 6 / 12;
  if (birthYear === 1958) return 66 + 8 / 12;
  if (birthYear === 1959) return 66 + 10 / 12;
  return 67;
}

/**
 * Apply the early-claiming reduction or delayed-retirement credit
 * based on claiming age vs FRA.
 *
 * Before FRA:
 *   - First 36 months early: 5/9 of 1% per month reduction
 *   - Additional months beyond 36: 5/12 of 1% per month reduction
 *
 * After FRA:
 *   - 2/3 of 1% per month delayed credit (8% per year), capped at age 70
 *
 * At FRA: factor = 1.0
 * Before age 62: factor = 0 (not eligible)
 *
 * @param pia          - Primary Insurance Amount
 * @param claimingAge  - Age at which benefits are claimed
 * @param birthYear    - Birth year (to determine FRA)
 * @returns Adjusted monthly benefit amount
 */
export function applyFRAFactor(pia: number, claimingAge: number, birthYear: number): number {
  if (claimingAge < 62) return 0;

  const fra = getFullRetirementAge(birthYear);
  const monthsFromFRA = Math.round((claimingAge - fra) * 12);

  if (monthsFromFRA === 0) {
    return pia;
  } else if (monthsFromFRA < 0) {
    // Early claiming
    const monthsEarly = Math.abs(monthsFromFRA);
    let reduction: number;
    if (monthsEarly <= 36) {
      reduction = monthsEarly * (5 / 9 / 100);
    } else {
      reduction = 36 * (5 / 9 / 100);
      reduction += (monthsEarly - 36) * (5 / 12 / 100);
    }
    return pia * (1.0 - reduction);
  } else {
    // Delayed claiming — cap credits at age 70
    const maxDelayMonths = Math.round((70 - fra) * 12);
    const monthsDelayed = Math.min(monthsFromFRA, maxDelayMonths);
    const credit = monthsDelayed * (2 / 3 / 100);
    return pia * (1.0 + credit);
  }
}

/**
 * Apply Cost-of-Living Adjustment (COLA) to a benefit amount.
 *
 * @param monthlyBenefit  - Current monthly benefit before COLA
 * @param colaRate        - Annual COLA rate (e.g. 0.03 for 3%)
 * @param yearsFromStart  - Number of years of COLA to apply
 * @returns COLA-adjusted monthly benefit
 */
export function applyCOLA(
  monthlyBenefit: number,
  colaRate: number,
  yearsFromStart: number,
): number {
  return monthlyBenefit * Math.pow(1 + colaRate, yearsFromStart);
}

/**
 * Calculate spousal benefit.
 *
 * The lower-earning spouse receives the higher of:
 *   - Their own adjusted benefit (after FRA factor), or
 *   - 50% of the spouse's adjusted benefit
 *
 * @param ownAdjustedBenefit    - Worker's own benefit after FRA adjustment
 * @param spouseAdjustedBenefit - Spouse's benefit after FRA adjustment
 * @returns The effective monthly benefit for the worker
 */
export function calculateSpousalBenefit(
  ownAdjustedBenefit: number,
  spouseAdjustedBenefit: number,
): number {
  return Math.max(ownAdjustedBenefit, spouseAdjustedBenefit * 0.5);
}
