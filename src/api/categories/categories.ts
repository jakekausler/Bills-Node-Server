import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadCategories, saveCategories } from '../../utils/io/categories';
import { getAccountsAndTransfers, saveData } from '../../utils/io/accountsAndTransfers';

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
export function getCategories(_request: Request) {
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
export async function addCategory(request: Request) {
  const data = await getData(request);
  const categories = loadCategories();
  const path = (data.data as { path?: string[] })?.path ?? data.path;

  if (!Array.isArray(path)) {
    throw new Error('Invalid path: must be an array');
  }

  if (path.length === 0 || path.length > 2) {
    throw new Error('Invalid path');
  }

  for (const item of path) {
    if (typeof item !== 'string') {
      throw new Error('Invalid path: all items must be strings');
    }
  }

  if (path.length === 1) {
    const section = path[0];
    if (!(section in categories)) {
      categories[section] = [];
    }
  } else {
    const section = path[0];
    const item = path[1];
    if (!(section in categories)) {
      categories[section] = [item];
    } else {
      categories[section].push(item);
      categories[section] = categories[section]
        .sort()
        .filter((value: string, index: number, self: string[]) => self.indexOf(value) === index);
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
export async function deleteCategory(request: Request) {
  const data = await getData(request);
  const categories = loadCategories();
  const path = (data.data as { path?: string[] })?.path ?? data.path;

  if (!Array.isArray(path)) {
    throw new Error('Invalid path: must be an array');
  }

  if (path.length === 0 || path.length > 2) {
    throw new Error('Invalid path');
  }

  for (const item of path) {
    if (typeof item !== 'string') {
      throw new Error('Invalid path: all items must be strings');
    }
  }

  if (path.length === 1) {
    const section = path[0];
    if (section in categories) {
      delete categories[section];
    }
  } else {
    const section = path[0];
    const item = path[1];
    if (section in categories && categories[section].includes(item)) {
      categories[section].splice(categories[section].indexOf(item), 1);
    }
  }

  saveCategories(categories);
  return categories;
}

/**
 * Renames a category section or item, updating all references in data.
 *
 * Body: { oldPath: string[], newName: string }
 * - oldPath length 1: rename section
 * - oldPath length 2: rename item within section
 *
 * Updates categories.json and all activity/bill category + spendingCategory
 * references in data.json.
 */
export async function renameCategory(request: Request) {
  const data = await getData(request);
  const body = (data.data as { oldPath?: string[]; newName?: string }) ?? data;
  const oldPath = body.oldPath ?? (data as any).oldPath;
  const newName = body.newName ?? (data as any).newName;

  if (!Array.isArray(oldPath) || oldPath.length === 0 || oldPath.length > 2) {
    throw new Error('Invalid oldPath: must be array of length 1 or 2');
  }
  if (typeof newName !== 'string' || !newName.trim()) {
    throw new Error('Invalid newName: must be a non-empty string');
  }

  const trimmedName = newName.trim();
  const categories = loadCategories();
  const simulation = (request.query.simulation as string) || 'Default';

  let oldCategoryPrefix: string;
  let newCategoryPrefix: string;
  let isFullReplace: boolean; // true = prefix match, false = exact match

  if (oldPath.length === 1) {
    // Rename section
    const oldSection = oldPath[0];
    if (!(oldSection in categories)) {
      throw new Error(`Section "${oldSection}" not found`);
    }
    if (trimmedName in categories && trimmedName !== oldSection) {
      throw new Error(`Section "${trimmedName}" already exists`);
    }

    // Rebuild categories with new key (preserve order)
    const entries = Object.entries(categories);
    const newCategories: Record<string, string[]> = {};
    for (const [key, value] of entries) {
      newCategories[key === oldSection ? trimmedName : key] = value;
    }
    // Clear and repopulate
    for (const key of Object.keys(categories)) delete categories[key];
    Object.assign(categories, newCategories);

    oldCategoryPrefix = `${oldSection}.`;
    newCategoryPrefix = `${trimmedName}.`;
    isFullReplace = false; // prefix match
  } else {
    // Rename item
    const [section, oldItem] = oldPath;
    if (!(section in categories)) {
      throw new Error(`Section "${section}" not found`);
    }
    const idx = categories[section].indexOf(oldItem);
    if (idx === -1) {
      throw new Error(`Item "${oldItem}" not found in section "${section}"`);
    }
    if (categories[section].includes(trimmedName) && trimmedName !== oldItem) {
      throw new Error(`Item "${trimmedName}" already exists in section "${section}"`);
    }

    categories[section][idx] = trimmedName;
    categories[section].sort();

    oldCategoryPrefix = `${section}.${oldItem}`;
    newCategoryPrefix = `${section}.${trimmedName}`;
    isFullReplace = true; // exact match
  }

  // Update all category references in data
  const accountsAndTransfers = getAccountsAndTransfers(simulation);
  let affectedCount = 0;

  function updateCategoryString(cat: string): string | null {
    if (isFullReplace) {
      // Item rename: exact match
      if (cat === oldCategoryPrefix) {
        return newCategoryPrefix;
      }
    } else {
      // Section rename: prefix match
      if (cat.startsWith(oldCategoryPrefix)) {
        return newCategoryPrefix + cat.slice(oldCategoryPrefix.length);
      }
    }
    return null;
  }

  for (const account of accountsAndTransfers.accounts) {
    for (const activity of account.activity) {
      const newCat = updateCategoryString(activity.category);
      if (newCat !== null) { activity.category = newCat; affectedCount++; }
      if (activity.spendingCategory) {
        const newSCat = updateCategoryString(activity.spendingCategory);
        if (newSCat !== null) { activity.spendingCategory = newSCat; }
      }
    }
    for (const bill of account.bills) {
      const newCat = updateCategoryString(bill.category);
      if (newCat !== null) { bill.category = newCat; affectedCount++; }
      if (bill.spendingCategory) {
        const newSCat = updateCategoryString(bill.spendingCategory);
        if (newSCat !== null) { bill.spendingCategory = newSCat; }
      }
    }
  }
  // Also check transfers
  for (const activity of accountsAndTransfers.transfers.activity) {
    const newCat = updateCategoryString(activity.category);
    if (newCat !== null) { activity.category = newCat; affectedCount++; }
    if (activity.spendingCategory) {
      const newSCat = updateCategoryString(activity.spendingCategory);
      if (newSCat !== null) { activity.spendingCategory = newSCat; }
    }
  }
  for (const bill of accountsAndTransfers.transfers.bills) {
    const newCat = updateCategoryString(bill.category);
    if (newCat !== null) { bill.category = newCat; affectedCount++; }
    if (bill.spendingCategory) {
      const newSCat = updateCategoryString(bill.spendingCategory);
      if (newSCat !== null) { bill.spendingCategory = newSCat; }
    }
  }

  saveCategories(categories);
  saveData(accountsAndTransfers, simulation);

  return { categories, affectedCount };
}
