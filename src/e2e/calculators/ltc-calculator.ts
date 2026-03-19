/**
 * Shadow calculator for LTC (Long-Term Care) costs.
 * Mirrors the deterministic expected-cost logic in ltc-manager.ts.
 * No engine imports — all data passed as parameters.
 */

function getAgeBand(age: number): string {
  if (age < 65) return '';
  if (age < 70) return '65-69';
  if (age < 75) return '70-74';
  if (age < 80) return '75-79';
  if (age < 85) return '80-84';
  if (age < 90) return '85-89';
  return '90+';
}

/**
 * Deterministic expected monthly LTC cost.
 * = sum(transition_probability_from_healthy * inflated_state_cost)
 * Returns 0 for ages under 65.
 */
export function getExpectedMonthlyCost(
  age: number,
  gender: string,
  year: number,
  transitionData: Record<string, any>,
  baseCosts: { homeCare: number; assistedLiving: number; nursingHome: number },
  baseYear: number,
  healthcareInflationRate: number,
): number {
  const ageBand = getAgeBand(age);
  if (!ageBand) return 0;

  const t = transitionData[ageBand]?.[gender];
  if (!t) return 0;

  const inflationFactor = Math.pow(1 + healthcareInflationRate, year - baseYear);

  const pHome = t.healthy_to_homeCare;
  const pAL = t.healthy_to_assistedLiving;
  const pNH = t.healthy_to_nursingHome;

  return (
    pHome * baseCosts.homeCare * inflationFactor +
    pAL * baseCosts.assistedLiving * inflationFactor +
    pNH * baseCosts.nursingHome * inflationFactor
  );
}

/**
 * Monthly insurance premium for LTC coverage.
 * Returns 0 if the person has not yet reached purchaseAge.
 */
export function getInsurancePremium(
  year: number,
  birthYear: number,
  config: { purchaseAge: number; annualPremium: number; premiumInflationRate: number },
): number {
  const age = year - birthYear;
  if (age < config.purchaseAge) return 0;

  const yearsSincePurchase = year - (birthYear + config.purchaseAge);
  const inflatedAnnual = config.annualPremium * Math.pow(1 + config.premiumInflationRate, yearsSincePurchase);
  return inflatedAnnual / 12;
}
