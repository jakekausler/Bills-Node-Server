import { getData } from '../../utils/net/request';
import { loadCategories, saveCategories } from '../../utils/io/categories';
/**
 * Retrieves all categories from the categories file.
 *
 * @param _request - Express request object (unused)
 * @returns Object containing all categories organized by sections
 *
 * @example
 * ```typescript
 * const categories = getCategories(request);
 * // Returns: {
 * //   "Housing": ["Rent", "Utilities", "Insurance"],
 * //   "Food": ["Groceries", "Dining"]
 * // }
 * ```
 */
export function getCategories(_request) {
    return loadCategories();
}
/**
 * Adds a new category section or item to the categories structure.
 *
 * Path validation:
 * - Length 1: Creates new section
 * - Length 2: Adds item to section (creates section if needed)
 * - Other lengths: Returns error
 *
 * Items are automatically sorted and deduplicated within sections.
 *
 * @param request - Express request object containing path array in request data
 * @returns Updated categories object or error object
 *
 * @example
 * ```typescript
 * // Add new section
 * const result = addCategory(request); // path: ["Transportation"]
 * // Returns: { ...existing, "Transportation": [] }
 *
 * // Add item to section
 * const result = addCategory(request); // path: ["Housing", "Rent"]
 * // Returns: { ...existing, "Housing": ["Rent", ...sorted items] }
 * ```
 */
export function addCategory(request) {
    const data = getData(request);
    const categories = loadCategories();
    const path = data.path;
    if (path.length === 0 || path.length > 2) {
        return { error: 'Invalid path' };
    }
    if (path.length === 1) {
        const section = path[0];
        if (!(section in categories)) {
            categories[section] = [];
        }
    }
    else {
        const section = path[0];
        const item = path[1];
        if (!(section in categories)) {
            categories[section] = [item];
        }
        else {
            categories[section].push(item);
            categories[section] = categories[section]
                .sort()
                .filter((value, index, self) => self.indexOf(value) === index);
        }
    }
    saveCategories(categories);
    return categories;
}
/**
 * Deletes a category section or item from the categories structure.
 *
 * Path validation:
 * - Length 1: Deletes entire section
 * - Length 2: Deletes specific item from section
 * - Other lengths: Returns error
 *
 * @param request - Express request object containing path array in request data
 * @returns Updated categories object or error object
 *
 * @example
 * ```typescript
 * // Delete entire section
 * const result = deleteCategory(request); // path: ["Transportation"]
 * // Returns: categories without Transportation section
 *
 * // Delete specific item
 * const result = deleteCategory(request); // path: ["Housing", "Rent"]
 * // Returns: categories with Rent removed from Housing
 * ```
 */
export function deleteCategory(request) {
    const data = getData(request);
    const categories = loadCategories();
    const path = data.path;
    if (path.length === 0 || path.length > 2) {
        return { error: 'Invalid path' };
    }
    if (path.length === 1) {
        const section = path[0];
        if (section in categories) {
            delete categories[section];
        }
    }
    else {
        const section = path[0];
        const item = path[1];
        if (section in categories && categories[section].includes(item)) {
            categories[section].splice(categories[section].indexOf(item), 1);
        }
    }
    saveCategories(categories);
    return categories;
}
