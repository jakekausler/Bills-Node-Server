import { load } from './io';
export function loadAverageWageIndex() {
    const averageWageIndex = load('averageWageIndex.json');
    return Object.fromEntries(Object.entries(averageWageIndex).map(([key, value]) => [parseInt(key), value]));
}
