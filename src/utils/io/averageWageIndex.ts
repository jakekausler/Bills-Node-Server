import { load } from './io';

export type AverageWageIndexData = Record<string, number>;
export type AverageWageIndex = Record<number, number>;

export function loadAverageWageIndex(): AverageWageIndex {
  const averageWageIndex = load<AverageWageIndexData>('averageWageIndex.json');
  return Object.fromEntries(Object.entries(averageWageIndex).map(([key, value]) => [parseInt(key), value]));
}
