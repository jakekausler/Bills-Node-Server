import { load } from './io';

export type BendPointsData = Record<string, { first: number; second: number }>;
export type BendPoints = Record<number, { first: number; second: number }>;

export function loadBendPoints(): BendPoints {
  const bendPoints = load<BendPointsData>('bendPoints.json');
  return Object.fromEntries(Object.entries(bendPoints).map(([key, value]) => [parseInt(key), value]));
}
