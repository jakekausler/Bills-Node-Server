import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export type DeductibleProgress = {
  configId: string;
  configName: string;
  planYear: number;
  individualDeductibleSpent: number;
  individualDeductibleRemaining: number;
  individualDeductibleMet: boolean;
  familyDeductibleSpent: number;
  familyDeductibleRemaining: number;
  familyDeductibleMet: boolean;
  individualOOPSpent: number;
  individualOOPRemaining: number;
  individualOOPMet: boolean;
  familyOOPSpent: number;
  familyOOPRemaining: number;
  familyOOPMet: boolean;
};

export async function getHealthcareProgress(
  request: Request
): Promise<Record<string, DeductibleProgress>> {
  // Extract query parameters
  const simulation = (request.query.simulation as string) || 'Default';
  const dateStr = (request.query.date as string) || new Date().toISOString().split('T')[0];
  const date = dayjs.utc(dateStr).toDate();

  // Load healthcare configurations
  const configs = await loadHealthcareConfigs();
  if (configs.length === 0) {
    return {};
  }

  // Load data and run calculation
  const data = await getData(request);
  const { accountsAndTransfers, startDate, endDate } = data;

  // Run calculation engine
  const calculatedData = await calculateAllActivity(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    false,
    1,
    1,
    false,
    false
  );

  // Build progress map by analyzing consolidated activities directly
  const progressMap: Record<string, DeductibleProgress> = {};

  // Get unique person names from configs
  const personNames = Array.from(new Set(configs.map(c => c.personName)));

  for (const personName of personNames) {
    // Get active config for this person at the specified date
    const config = configs.find(
      c =>
        c.personName === personName &&
        dayjs.utc(c.startDate).toDate() <= date &&
        (c.endDate === null || dayjs.utc(c.endDate).toDate() >= date)
    );

    if (!config) {
      continue;
    }

    // Calculate plan year
    const planYear = getPlanYear(date, config.resetMonth, config.resetDay);

    // Calculate spending by analyzing activities
    const spending = calculateSpending(
      calculatedData.accounts,
      personName,
      config,
      date,
      planYear
    );

    progressMap[personName] = {
      configId: config.id,
      configName: config.name,
      planYear,
      individualDeductibleSpent: spending.individualDeductible,
      individualDeductibleRemaining: Math.max(
        0,
        config.individualDeductible - spending.individualDeductible
      ),
      individualDeductibleMet: spending.individualDeductible >= config.individualDeductible,
      familyDeductibleSpent: spending.familyDeductible,
      familyDeductibleRemaining: Math.max(
        0,
        config.familyDeductible - spending.familyDeductible
      ),
      familyDeductibleMet: spending.familyDeductible >= config.familyDeductible,
      individualOOPSpent: spending.individualOOP,
      individualOOPRemaining: Math.max(
        0,
        config.individualOutOfPocketMax - spending.individualOOP
      ),
      individualOOPMet: spending.individualOOP >= config.individualOutOfPocketMax,
      familyOOPSpent: spending.familyOOP,
      familyOOPRemaining: Math.max(0, config.familyOutOfPocketMax - spending.familyOOP),
      familyOOPMet: spending.familyOOP >= config.familyOutOfPocketMax,
    };
  }

  return progressMap;
}

/**
 * Calculate healthcare spending from consolidated activities
 */
function calculateSpending(
  accounts: any[],
  personName: string,
  config: any,
  asOfDate: Date,
  planYear: number
) {
  let individualDeductible = 0;
  let individualOOP = 0;
  let familyDeductible = 0;
  let familyOOP = 0;

  // Calculate plan year start date
  const planYearStart = new Date(planYear, config.resetMonth, config.resetDay);
  const planYearEnd = new Date(planYear + 1, config.resetMonth, config.resetDay);

  // Collect all family members from same config (for family aggregation)
  // For now, assume each person has their own config; family totals = individual totals
  // TODO: Handle shared family configs if implemented

  for (const account of accounts) {
    if (!account.consolidatedActivity) {
      continue;
    }

    for (const activity of account.consolidatedActivity) {
      if (!activity.isHealthcare) {
        continue;
      }

      if (activity.healthcarePerson !== personName) {
        continue;
      }

      const activityDate = dayjs.utc(activity.date).toDate();

      // Only include activities within the plan year and up to the query date
      if (activityDate < planYearStart || activityDate > asOfDate) {
        continue;
      }

      if (activityDate >= planYearEnd) {
        continue;
      }

      const cost = Math.abs(Number(activity.amount));

      // Count toward deductible if specified
      if (activity.countsTowardDeductible !== false) {
        individualDeductible += cost;
        familyDeductible += cost;
      }

      // Count toward OOP if specified
      if (activity.countsTowardOutOfPocket !== false) {
        individualOOP += cost;
        familyOOP += cost;
      }
    }
  }

  return {
    individualDeductible,
    individualOOP,
    familyDeductible,
    familyOOP,
  };
}

/**
 * Determine which plan year a given date falls into based on reset date.
 *
 * Example: If reset is Jan 1 (resetMonth=0, resetDay=1):
 *   - Dec 15, 2024 → plan year 2024
 *   - Jan 2, 2024 → plan year 2024
 *
 * Example: If reset is July 1 (resetMonth=6, resetDay=1):
 *   - June 30, 2024 → plan year 2023
 *   - July 1, 2024 → plan year 2024
 */
function getPlanYear(date: Date, resetMonth: number, resetDay: number): number {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // Check if date is before reset date in this calendar year
  const beforeReset =
    month < resetMonth || (month === resetMonth && day < resetDay);

  // If before reset, we're still in previous plan year
  return beforeReset ? year - 1 : year;
}
