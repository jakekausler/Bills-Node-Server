import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';
import { HealthcareManager } from '../../utils/calculate-v3/healthcare-manager';
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

  // Load data and run calculation to populate healthcare manager state
  const data = getData(request);
  const { accountsAndTransfers, startDate, endDate } = data;

  // Run calculation engine (this updates healthcare manager's internal trackers)
  await calculateAllActivity(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    false, // monteCarlo
    1,     // simulationNumber
    1,     // totalSimulations
    false, // forceRecalculation
    false  // enableLogging
  );

  // Create healthcare manager with configs to query progress
  const healthcareManager = new HealthcareManager(configs);

  // Build progress map keyed by person name
  const progressMap: Record<string, DeductibleProgress> = {};

  // Get unique person names from configs
  const personNames = Array.from(new Set(configs.map(c => c.personName)));

  for (const personName of personNames) {
    // Get active config for this person at the specified date
    const config = healthcareManager.getActiveConfig(personName, date);
    if (!config) {
      continue; // No active config for this person at this date
    }

    // Get deductible progress
    const deductibleProgress = healthcareManager.getDeductibleProgress(config, date, personName);

    // Get OOP progress
    const oopProgress = healthcareManager.getOOPProgress(config, date, personName);

    // Calculate plan year based on reset date
    const planYear = getPlanYear(date, config.resetMonth, config.resetDay);

    // Calculate spent amounts
    const individualDeductibleSpent = config.individualDeductible - deductibleProgress.individualRemaining;
    const familyDeductibleSpent = config.familyDeductible - deductibleProgress.familyRemaining;
    const individualOOPSpent = config.individualOutOfPocketMax - oopProgress.individualRemaining;
    const familyOOPSpent = config.familyOutOfPocketMax - oopProgress.familyRemaining;

    progressMap[personName] = {
      configId: config.id,
      configName: config.name,
      planYear,
      individualDeductibleSpent,
      individualDeductibleRemaining: deductibleProgress.individualRemaining,
      individualDeductibleMet: deductibleProgress.individualMet,
      familyDeductibleSpent,
      familyDeductibleRemaining: deductibleProgress.familyRemaining,
      familyDeductibleMet: deductibleProgress.familyMet,
      individualOOPSpent,
      individualOOPRemaining: oopProgress.individualRemaining,
      individualOOPMet: oopProgress.individualMet,
      familyOOPSpent,
      familyOOPRemaining: oopProgress.familyRemaining,
      familyOOPMet: oopProgress.familyMet,
    };
  }

  return progressMap;
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
