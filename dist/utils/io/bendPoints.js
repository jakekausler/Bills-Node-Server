import { load } from './io';
export function loadBendPoints() {
    const bendPoints = load('bendPoints.json');
    return Object.fromEntries(Object.entries(bendPoints).map(([key, value]) => [parseInt(key), value]));
}
