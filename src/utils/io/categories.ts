import { load, save } from './io';
import { Categories } from './types';

const FILE_NAME = 'categories';

/**
 * Loads category configuration from the categories.json file.
 * 
 * @returns Categories object containing category sections and items
 * 
 * @example
 * ```typescript
 * const categories = loadCategories();
 * // Returns: {
 * //   "Housing": ["Rent", "Utilities"],
 * //   "Food": ["Groceries", "Dining"]
 * // }
 * ```
 */
export function loadCategories() {
  return load<Categories>(`${FILE_NAME}.json`);
}

/**
 * Saves category configuration to the categories.json file.
 * 
 * @param data - Categories object to save
 * 
 * @example
 * ```typescript
 * const categories = {
 *   "Housing": ["Rent", "Utilities"],
 *   "Food": ["Groceries", "Dining"]
 * };
 * saveCategories(categories);
 * ```
 */
export function saveCategories(data: Categories) {
  save<Categories>(data, `${FILE_NAME}.json`);
}
