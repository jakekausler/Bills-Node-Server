import { load, save } from './io';
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
    return load(`${FILE_NAME}.json`);
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
export function saveCategories(data) {
    save(data, `${FILE_NAME}.json`);
}
