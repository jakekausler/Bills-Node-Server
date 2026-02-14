import { load, save, checkExists } from './io';
import { SpendingTrackerCategory, SpendingTrackerData } from '../../data/spendingTracker/types';

const FILE_NAME = 'spending-tracker';

export function loadSpendingTrackerCategories(): SpendingTrackerCategory[] {
  if (!checkExists(`${FILE_NAME}.json`)) {
    return [];
  }
  const data = load<SpendingTrackerData>(`${FILE_NAME}.json`);
  return data.categories || [];
}

export function saveSpendingTrackerCategories(categories: SpendingTrackerCategory[]): void {
  const data: SpendingTrackerData = { categories };
  save<SpendingTrackerData>(data, `${FILE_NAME}.json`);
}
