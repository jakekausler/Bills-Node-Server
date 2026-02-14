import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import {
  loadSpendingTrackerCategories,
  saveSpendingTrackerCategories,
} from '../../utils/io/spendingTracker';
import { load } from '../../utils/io/io';
import { loadCategories, saveCategories } from '../../utils/io/categories';
import { resetCache } from '../../utils/io/cache';
import { AccountsAndTransfersData } from '../../data/account/types';

/**
 * Validates a spending tracker category, returning an array of error messages.
 * Returns an empty array if valid.
 *
 * @param category - The category to validate
 * @param allCategories - All existing categories (for uniqueness check)
 * @param excludeId - ID to exclude from uniqueness check (for updates)
 * @returns Array of validation error messages
 */
function validateCategory(
  category: SpendingTrackerCategory,
  allCategories: SpendingTrackerCategory[],
  excludeId?: string,
): string[] {
  const errors: string[] = [];

  if (!category.name || category.name.trim() === '') {
    errors.push('Name is required');
  }

  // Check uniqueness (exclude current category on update)
  const duplicate = allCategories.find(
    (c) => c.name === category.name && c.id !== excludeId,
  );
  if (duplicate) {
    errors.push('Category name must be unique');
  }

  if (category.threshold === undefined || category.threshold === null) {
    errors.push('Threshold is required');
  } else if (category.threshold < 0) {
    errors.push('Threshold must be >= 0');
  }

  // Validate interval enum
  const validIntervals = ['weekly', 'monthly', 'yearly'];
  if (!category.interval || !validIntervals.includes(category.interval)) {
    errors.push('Interval must be one of: weekly, monthly, yearly');
  }

  if (!category.accountId) {
    errors.push('Account ID is required');
  } else {
    // Validate account exists by loading raw data file
    const data = load<AccountsAndTransfersData>('data.json');
    const accountExists = data.accounts.some(
      (a) => a.id === category.accountId,
    );
    if (!accountExists) {
      errors.push('Account ID does not reference an existing account');
    }
  }

  if (category.interval === 'monthly') {
    const day = parseInt(category.intervalStart, 10);
    if (isNaN(day) || day < 1 || day > 28) {
      errors.push('Monthly interval start must be between 1 and 28');
    }
  }

  // Validate thresholdChanges sorted and no duplicate dates
  if (category.thresholdChanges && category.thresholdChanges.length > 0) {
    for (let i = 1; i < category.thresholdChanges.length; i++) {
      if (
        category.thresholdChanges[i].date <=
        category.thresholdChanges[i - 1].date
      ) {
        errors.push(
          'Threshold changes must be sorted chronologically with no duplicate dates',
        );
        break;
      }
    }
    for (const change of category.thresholdChanges) {
      if (change.newThreshold < 0) {
        errors.push('Threshold change newThreshold must be >= 0');
        break;
      }
    }
  }

  return errors;
}

/**
 * Error class with an HTTP status code for API error responses.
 */
export class ApiError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

/**
 * Retrieves all spending tracker categories.
 *
 * @param _request - Express request object (unused)
 * @returns Array of all spending tracker categories
 */
export function getSpendingTrackerCategories(
  _request: Request,
): SpendingTrackerCategory[] {
  return loadSpendingTrackerCategories();
}

/**
 * Retrieves a single spending tracker category by ID.
 *
 * @param request - Express request object with id param
 * @returns The matching spending tracker category
 * @throws Error with statusCode 404 if category not found
 */
export function getSpendingTrackerCategory(
  request: Request,
): SpendingTrackerCategory {
  const { id } = request.params;
  const categories = loadSpendingTrackerCategories();
  const category = categories.find((c) => c.id === id);

  if (!category) {
    throw new ApiError('Spending tracker category not found', 404);
  }

  return category;
}

/**
 * Creates a new spending tracker category.
 *
 * Generates a UUID, validates the category, saves it, updates categories.json,
 * and clears the calculation cache.
 *
 * @param request - Express request object with category data in body
 * @returns The newly created spending tracker category
 * @throws Error with statusCode 400 if validation fails
 */
export function createSpendingTrackerCategory(
  request: Request,
): SpendingTrackerCategory {
  const categories = loadSpendingTrackerCategories();

  const newCategory: SpendingTrackerCategory = {
    id: uuidv4(),
    name: request.body.name,
    threshold: request.body.threshold,
    thresholdIsVariable: request.body.thresholdIsVariable,
    thresholdVariable: request.body.thresholdVariable,
    interval: request.body.interval,
    intervalStart: request.body.intervalStart,
    accountId: request.body.accountId,
    carryOver: request.body.carryOver,
    carryUnder: request.body.carryUnder,
    increaseBy: request.body.increaseBy,
    increaseByIsVariable: request.body.increaseByIsVariable,
    increaseByVariable: request.body.increaseByVariable,
    increaseByDate: request.body.increaseByDate,
    thresholdChanges: request.body.thresholdChanges,
  };

  const errors = validateCategory(newCategory, categories);
  if (errors.length > 0) {
    throw new ApiError(errors.join('; '), 400);
  }

  categories.push(newCategory);
  saveSpendingTrackerCategories(categories);

  // Update categories.json: add name under "Spending Tracker" key
  const cats = loadCategories();
  if (!cats['Spending Tracker']) {
    cats['Spending Tracker'] = [];
  }
  cats['Spending Tracker'].push(newCategory.name);
  saveCategories(cats);

  resetCache();

  return newCategory;
}

/**
 * Updates an existing spending tracker category.
 *
 * Validates the updated category, handles name changes in categories.json,
 * saves the updated data, and clears the calculation cache.
 *
 * @param request - Express request object with id param and category data in body
 * @returns The updated spending tracker category
 * @throws Error with statusCode 404 if category not found
 * @throws Error with statusCode 400 if validation fails
 */
export function updateSpendingTrackerCategory(
  request: Request,
): SpendingTrackerCategory {
  const { id } = request.params;
  const categories = loadSpendingTrackerCategories();
  const existingIndex = categories.findIndex((c) => c.id === id);

  if (existingIndex === -1) {
    throw new ApiError('Spending tracker category not found', 404);
  }

  const oldName = categories[existingIndex].name;

  const updatedCategory: SpendingTrackerCategory = {
    id,
    name: request.body.name,
    threshold: request.body.threshold,
    thresholdIsVariable: request.body.thresholdIsVariable,
    thresholdVariable: request.body.thresholdVariable,
    interval: request.body.interval,
    intervalStart: request.body.intervalStart,
    accountId: request.body.accountId,
    carryOver: request.body.carryOver,
    carryUnder: request.body.carryUnder,
    increaseBy: request.body.increaseBy,
    increaseByIsVariable: request.body.increaseByIsVariable,
    increaseByVariable: request.body.increaseByVariable,
    increaseByDate: request.body.increaseByDate,
    thresholdChanges: request.body.thresholdChanges,
  };

  const errors = validateCategory(updatedCategory, categories, id);
  if (errors.length > 0) {
    throw new ApiError(errors.join('; '), 400);
  }

  // If name changed, update categories.json
  if (oldName !== updatedCategory.name) {
    const cats = loadCategories();
    if (!cats['Spending Tracker']) {
      cats['Spending Tracker'] = [];
    } else {
      cats['Spending Tracker'] = cats['Spending Tracker'].filter(
        (n) => n !== oldName,
      );
    }
    cats['Spending Tracker'].push(updatedCategory.name);
    saveCategories(cats);
  }

  categories[existingIndex] = updatedCategory;
  saveSpendingTrackerCategories(categories);

  resetCache();

  return updatedCategory;
}

/**
 * Deletes a spending tracker category by ID.
 *
 * Removes the category from storage, updates categories.json,
 * and clears the calculation cache.
 *
 * @param request - Express request object with id param
 * @returns Success indicator object
 * @throws Error with statusCode 404 if category not found
 */
export function deleteSpendingTrackerCategory(
  request: Request,
): { success: boolean } {
  const { id } = request.params;
  const categories = loadSpendingTrackerCategories();
  const existingIndex = categories.findIndex((c) => c.id === id);

  if (existingIndex === -1) {
    throw new ApiError('Spending tracker category not found', 404);
  }

  const deletedCategory = categories[existingIndex];

  // Remove from array and save
  categories.splice(existingIndex, 1);
  saveSpendingTrackerCategories(categories);

  // Update categories.json: remove name from "Spending Tracker" key
  const cats = loadCategories();
  if (cats['Spending Tracker']) {
    cats['Spending Tracker'] = cats['Spending Tracker'].filter(
      (n) => n !== deletedCategory.name,
    );
  }
  saveCategories(cats);

  resetCache();

  return { success: true };
}
