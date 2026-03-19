/**
 * Shadow calculator for healthcare patient cost through deductible/OOP.
 * Independent implementation — no engine imports.
 *
 * Replicates the cost-sharing logic from the engine's HealthcareManager
 * calculatePatientCost, calculateCopayBasedCost, and calculateDeductibleBasedCost
 * methods.
 */

export interface PatientCostResult {
  patientCost: number;
  newDeductibleSpent: number;
  newOOPSpent: number;
  newFamilyDeductibleSpent: number;
  newFamilyOOPSpent: number;
}

/**
 * Calculate the patient's out-of-pocket cost for a healthcare expense.
 *
 * Logic mirrors the engine's HealthcareManager:
 * 1. If individual OR family OOP max already met -> $0
 * 2. If copay (copayAmount > 0): patient pays copay; optionally tracks toward deductible/OOP
 * 3. If coinsurance: patient pays 100% through deductible, then coinsurance% on remainder
 * 4. Cap at remaining OOP max (effective = min(individual, family))
 * 5. Track both individual and family aggregation
 *
 * All amounts are pre-inflated by the caller.
 */
export function calculatePatientCost(
  billAmount: number,
  copayAmount: number | null,
  coinsurancePercent: number | null,
  countsTowardDeductible: boolean,
  countsTowardOOP: boolean,
  deductibleSpent: number,
  oopSpent: number,
  individualDeductible: number,
  individualOOPMax: number,
  familyDeductibleSpent: number,
  familyOOPSpent: number,
  familyDeductible: number,
  familyOOPMax: number,
): PatientCostResult {
  const amount = Math.abs(billAmount);

  // Start with current spent values — we will add to them
  let newDeductibleSpent = deductibleSpent;
  let newOOPSpent = oopSpent;
  let newFamilyDeductibleSpent = familyDeductibleSpent;
  let newFamilyOOPSpent = familyOOPSpent;

  // Check if OOP max already met (individual OR family)
  const individualOOPMet = oopSpent >= individualOOPMax;
  const familyOOPMet = familyOOPSpent >= familyOOPMax;

  if (individualOOPMet || familyOOPMet) {
    return {
      patientCost: 0,
      newDeductibleSpent,
      newOOPSpent,
      newFamilyDeductibleSpent,
      newFamilyOOPSpent,
    };
  }

  // Copay path: copayAmount > 0 means use copay logic
  const hasCopay = copayAmount !== null && copayAmount !== undefined && copayAmount > 0;

  let patientCost: number;

  if (hasCopay) {
    // --- Copay-based cost ---
    const copay = copayAmount!;
    patientCost = copay;

    // Track toward deductible if configured (full bill amount, not copay)
    if (countsTowardDeductible) {
      newDeductibleSpent += amount;
      newFamilyDeductibleSpent += amount;
    }

    // Track toward OOP if configured (copay amount)
    if (countsTowardOOP) {
      newOOPSpent += copay;
      newFamilyOOPSpent += copay;
    }
  } else {
    // --- Deductible / coinsurance path ---
    const coinsurance = coinsurancePercent ?? 0;

    // Effective remaining deductible = min(individual remaining, family remaining)
    const individualDeductibleRemaining = Math.max(0, individualDeductible - deductibleSpent);
    const familyDeductibleRemaining = Math.max(0, familyDeductible - familyDeductibleSpent);
    const remainingDeductible = Math.min(individualDeductibleRemaining, familyDeductibleRemaining);

    const deductibleMet = individualDeductibleRemaining <= 0;

    if (!deductibleMet) {
      if (amount <= remainingDeductible) {
        // Entire bill within deductible — patient pays 100%
        patientCost = amount;

        if (countsTowardDeductible) {
          newDeductibleSpent += amount;
          newFamilyDeductibleSpent += amount;
        }
        if (countsTowardOOP) {
          newOOPSpent += patientCost;
          newFamilyOOPSpent += patientCost;
        }
      } else {
        // Bill exceeds remaining deductible — split
        const amountAfterDeductible = amount - remainingDeductible;
        const coinsuranceOnRemainder = amountAfterDeductible * (coinsurance / 100);
        patientCost = remainingDeductible + coinsuranceOnRemainder;

        if (countsTowardDeductible) {
          newDeductibleSpent += remainingDeductible;
          newFamilyDeductibleSpent += remainingDeductible;
        }
        if (countsTowardOOP) {
          newOOPSpent += patientCost;
          newFamilyOOPSpent += patientCost;
        }
      }
    } else {
      // Deductible already met — check OOP
      // (We already checked OOP max at the top, so here we are between deductible and OOP max)
      patientCost = amount * (coinsurance / 100);

      if (countsTowardOOP) {
        newOOPSpent += patientCost;
        newFamilyOOPSpent += patientCost;
      }
    }
  }

  return {
    patientCost,
    newDeductibleSpent,
    newOOPSpent,
    newFamilyDeductibleSpent,
    newFamilyOOPSpent,
  };
}

/**
 * Inflate a healthcare amount forward from a base year.
 *
 * Uses simple compound inflation: baseAmount * (1 + rate)^years
 * Result is rounded to the nearest dollar (matching engine behavior).
 */
export function inflateHealthcareAmount(
  baseAmount: number,
  inflationRate: number,
  yearsFromBase: number,
): number {
  const years = Math.max(0, yearsFromBase);
  return Math.round(baseAmount * Math.pow(1 + inflationRate, years));
}
