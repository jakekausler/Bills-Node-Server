import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { SpendingTrackerCategory, ChartDataResponse } from '../../data/spendingTracker/types';
import {
  loadSpendingTrackerCategories,
  saveSpendingTrackerCategories,
} from '../../utils/io/spendingTracker';
import { load } from '../../utils/io/io';
import { loadCategories, saveCategories } from '../../utils/io/categories';
import { resetCache } from '../../utils/io/cache';
import { AccountsAndTransfersData } from '../../data/account/types';
import { computePeriodBoundaries } from '../../utils/calculate-v3/period-utils';
import { getData } from '../../utils/net/request';
import { minDate } from '../../utils/io/minDate';
import { SpendingTrackerManager } from '../../utils/calculate-v3/spending-tracker-manager';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';

dayjs.extend(utc);

const SKIP_LOOKAHEAD_YEARS = 2;

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
    startDate: null,
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
    startDate: request.body.startDate ?? categories[existingIndex].startDate ?? null,
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

/**
 * Skips the current spending tracker period for a category.
 *
 * Computes period boundaries from today forward, finds the first active
 * (non-skipped) period, and advances startDate past that period.
 *
 * @param request - Express request object with id param
 * @returns The updated spending tracker category with new startDate
 * @throws ApiError with 404 if category not found
 * @throws ApiError with 400 if no more periods to skip
 */
export function skipSpendingTrackerCategory(request: Request): SpendingTrackerCategory {
  const { id } = request.params;
  const categories = loadSpendingTrackerCategories();
  const existingIndex = categories.findIndex((c) => c.id === id);

  if (existingIndex === -1) {
    throw new ApiError('Spending tracker category not found', 404);
  }

  const category = categories[existingIndex];

  // Compute period boundaries from today forward
  const now = dayjs.utc().startOf('day');
  const farFuture = now.add(SKIP_LOOKAHEAD_YEARS, 'year');

  const boundaries = computePeriodBoundaries(
    category.interval,
    category.intervalStart,
    now.toDate(),
    farFuture.toDate(),
  );

  // Filter out already-skipped periods
  const startDate = category.startDate ? dayjs.utc(category.startDate) : null;
  const activeBoundaries = startDate
    ? boundaries.filter(b => !dayjs.utc(b.periodEnd).isBefore(startDate, 'day'))
    : boundaries;

  if (activeBoundaries.length < 2) {
    throw new ApiError('No more periods to skip', 400);
  }

  // Advance startDate past the first active period
  const firstPeriodEnd = dayjs.utc(activeBoundaries[0].periodEnd);
  category.startDate = firstPeriodEnd.add(1, 'day').format('YYYY-MM-DD');

  categories[existingIndex] = category;
  saveSpendingTrackerCategories(categories);

  resetCache();

  return category;
}

/**
 * Retrieves chart data for a spending tracker category.
 *
 * Loads the calculation engine result (with caching), collects all consolidated
 * activities across accounts, and computes per-period spending chart data.
 *
 * @param request - Express request object with id param and startDate/endDate query params
 * @returns ChartDataResponse with per-period data and summary statistics
 * @throws ApiError with 404 if category not found
 */
export async function getSpendingTrackerChartData(
  request: Request,
): Promise<ChartDataResponse> {
  const { id } = request.params;

  // Load category
  const categories = loadSpendingTrackerCategories();
  const category = categories.find((c) => c.id === id);

  if (!category) {
    throw new ApiError('Spending tracker category not found', 404);
  }

  // Extract date range from query params
  const startDate = request.query.startDate as string;
  const endDate = request.query.endDate as string;

  if (!startDate || !endDate) {
    throw new ApiError('startDate and endDate query parameters are required', 400);
  }

  // Load engine data (uses cache)
  const data = await getData(request);

  // Extract calculation start date (inflation anchor)
  const calculationStartDate = minDate(data.accountsAndTransfers);
  const calculationStartDateStr = dayjs.utc(calculationStartDate).format('YYYY-MM-DD');

  // Collect all consolidated activities across all accounts
  const allActivities: ConsolidatedActivity[] = [];
  for (const account of data.accountsAndTransfers.accounts) {
    allActivities.push(...account.consolidatedActivity);
  }

  // Compute chart data
  return SpendingTrackerManager.computeChartData(
    category,
    allActivities,
    { startDate, endDate },
    calculationStartDateStr,
    data.simulation,
  );
}
