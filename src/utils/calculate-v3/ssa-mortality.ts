/**
 * Shared SSA mortality lookup utility.
 * Extracted from MortalityManager to avoid duplication in InheritanceManager.
 */

export interface SSALifeTable {
  male: Record<string, number>;
  female: Record<string, number>;
}

export function getAnnualDeathProbability(
  age: number,
  gender: 'male' | 'female',
  ssaLifeTable: SSALifeTable,
): number {
  const ageKey = Math.min(Math.floor(age), 119).toString();
  return ssaLifeTable[gender]?.[ageKey] ?? 0;
}
