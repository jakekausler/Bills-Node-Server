/**
 * Shared SSA mortality lookup utility.
 * Extracted from MortalityManager to avoid duplication in InheritanceManager.
 */
export function getAnnualDeathProbability(
  age: number,
  gender: 'male' | 'female',
  ssaLifeTable: Record<string, Record<string, number>>,
): number {
  const ageKey = Math.min(Math.floor(age), 119).toString();
  return ssaLifeTable[gender]?.[ageKey] ?? 0;
}
