import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { HealthcareConfig } from '../../data/healthcare/types';
import { Account } from '../../data/account/account';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';

dayjs.extend(utc);

export type DeductibleProgress = {
  configId: string;
  configName: string;
  planYear: number;
  coveredPersons: string[];

  // Family-level aggregates (primary)
  familyDeductibleSpent: number;
  familyDeductibleRemaining: number;
  familyDeductibleMet: boolean;
  familyOOPSpent: number;
  familyOOPRemaining: number;
  familyOOPMet: boolean;

  // Per-person breakdown (for expandable detail)
  individualProgress: {
    personName: string;
    deductibleSpent: number;
    deductibleMet: boolean;
    oopSpent: number;
    oopMet: boolean;
  }[];

  // Thresholds for display
  individualDeductibleLimit: number;
  familyDeductibleLimit: number;
  individualOOPLimit: number;
  familyOOPLimit: number;
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

  // Build bill lookup map for original amounts (same as in expenses.ts)
  const billLookup = new Map<string, number>();
  for (const account of accountsAndTransfers.accounts) {
    if (account.bills) {
      for (const bill of account.bills) {
        billLookup.set(bill.id, Math.abs(Number(bill.amount)));
      }
    }
  }
  for (const bill of calculatedData.transfers.bills) {
    if (!billLookup.has(bill.id)) {
      billLookup.set(bill.id, Math.abs(Number(bill.amount)));
    }
  }

  // Build progress map - one record per config (not per person)
  const progressMap: Record<string, DeductibleProgress> = {};

  // Filter to active configs at the specified date
  const activeConfigs = configs.filter(
    c =>
      dayjs.utc(c.startDate).toDate() <= date &&
      (c.endDate === null || dayjs.utc(c.endDate).toDate() >= date)
  );

  for (const config of activeConfigs) {
    // Skip configs with invalid coveredPersons data
    if (!Array.isArray(config.coveredPersons) || config.coveredPersons.length === 0) {
      console.warn(`Skipping config ${config.id}: coveredPersons must be a non-empty array`);
      continue;
    }

    // Calculate plan year
    const planYear = getPlanYear(date, config.resetMonth, config.resetDay);

    // Calculate spending for each covered person
    const personSpending = new Map<string, { deductible: number; oop: number }>();

    for (const personName of config.coveredPersons) {
      const spending = calculateSpending(
        calculatedData.accounts,
        personName,
        config,
        date,
        planYear,
        billLookup
      );
      personSpending.set(personName, {
        deductible: spending.individualDeductible,
        oop: spending.individualOOP,
      });
    }

    // Calculate family totals (sum across all covered persons)
    let familyDeductibleSpent = 0;
    let familyOOPSpent = 0;
    for (const spending of personSpending.values()) {
      familyDeductibleSpent += spending.deductible;
      familyOOPSpent += spending.oop;
    }

    // Build individual progress breakdown
    const individualProgress = config.coveredPersons.map(personName => {
      const spending = personSpending.get(personName) || { deductible: 0, oop: 0 };
      return {
        personName,
        deductibleSpent: spending.deductible,
        deductibleMet: spending.deductible >= config.individualDeductible,
        oopSpent: spending.oop,
        oopMet: spending.oop >= config.individualOutOfPocketMax,
      };
    });

    // Store progress record keyed by config ID
    progressMap[config.id] = {
      configId: config.id,
      configName: config.name,
      planYear,
      coveredPersons: config.coveredPersons,

      // Family-level aggregates
      familyDeductibleSpent,
      familyDeductibleRemaining: Math.max(0, config.familyDeductible - familyDeductibleSpent),
      familyDeductibleMet: familyDeductibleSpent >= config.familyDeductible,
      familyOOPSpent,
      familyOOPRemaining: Math.max(0, config.familyOutOfPocketMax - familyOOPSpent),
      familyOOPMet: familyOOPSpent >= config.familyOutOfPocketMax,

      // Per-person breakdown
      individualProgress,

      // Thresholds
      individualDeductibleLimit: config.individualDeductible,
      familyDeductibleLimit: config.familyDeductible,
      individualOOPLimit: config.individualOutOfPocketMax,
      familyOOPLimit: config.familyOutOfPocketMax,
    };
  }

  return progressMap;
}

/**
 * Calculate healthcare spending from consolidated activities for a single person
 * This replicates the logic from healthcare-manager.ts to reconstruct deductible/OOP progress
 */
function calculateSpending(
  accounts: Account[],
  personName: string,
  config: HealthcareConfig,
  asOfDate: Date,
  planYear: number,
  billLookup: Map<string, number>
) {
  let individualDeductible = 0;
  let individualOOP = 0;

  // Calculate plan year start date using UTC to match rest of codebase
  const planYearStart = dayjs.utc()
    .year(planYear)
    .month(config.resetMonth)
    .date(config.resetDay)
    .startOf('day')
    .toDate();
  const planYearEnd = dayjs.utc()
    .year(planYear + 1)
    .month(config.resetMonth)
    .date(config.resetDay)
    .startOf('day')
    .toDate();

  // Collect all healthcare activities for this person in the plan year
  const activities: ConsolidatedActivity[] = [];
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

      activities.push(activity);
    }
  }

  // Sort activities by date to process chronologically
  activities.sort((a, b) => {
    const dateA = dayjs.utc(a.date).toDate().getTime();
    const dateB = dayjs.utc(b.date).toDate().getTime();
    return dateA - dateB;
  });

  // Process activities in chronological order, tracking progress as we go
  for (const activity of activities) {
    // Patient cost (what the patient paid)
    const patientCost = Math.abs(Number(activity.amount));

    // Bill amount (original medical bill amount) - look up by billId
    // If no billId (one-time activity), use patient cost as bill amount
    const billAmount = activity.billId
      ? (billLookup.get(activity.billId) || 0)
      : patientCost;

    // Check if this is a copay-based expense (copayAmount > 0)
    const hasCopay = activity.copayAmount !== null &&
                     activity.copayAmount !== undefined &&
                     activity.copayAmount > 0;

    if (hasCopay) {
      // Copay-based expense
      // Count full bill amount toward deductible if configured
      if (activity.countsTowardDeductible !== false) {
        individualDeductible += billAmount;
      }

      // Count copay amount toward OOP if configured
      if (activity.countsTowardOutOfPocket !== false) {
        individualOOP += Math.abs(activity.copayAmount);
      }
    } else {
      // Deductible/coinsurance-based expense
      // Need to replicate the healthcare manager's logic

      // Check if deductible is already met
      const deductibleMet = individualDeductible >= config.individualDeductible;
      const oopMet = individualOOP >= config.individualOutOfPocketMax;

      if (!deductibleMet) {
        // Deductible not yet met
        const remainingDeductible = config.individualDeductible - individualDeductible;
        const amountToDeductible = Math.min(billAmount, remainingDeductible);

        if (billAmount <= remainingDeductible) {
          // Entire bill is within deductible - patient pays 100%
          if (activity.countsTowardDeductible !== false) {
            individualDeductible += amountToDeductible;
          }
          if (activity.countsTowardOutOfPocket !== false) {
            individualOOP += patientCost;
          }
        } else {
          // Bill exceeds remaining deductible - split calculation
          const coinsurancePercent = activity.coinsurancePercent || 0;
          const amountAfterDeductible = billAmount - remainingDeductible;
          const coinsuranceOnRemainder = amountAfterDeductible * (coinsurancePercent / 100);
          const totalPatientPays = remainingDeductible + coinsuranceOnRemainder;

          if (activity.countsTowardDeductible !== false) {
            individualDeductible += remainingDeductible;
          }
          if (activity.countsTowardOutOfPocket !== false) {
            individualOOP += totalPatientPays;
          }
        }
      } else if (!oopMet) {
        // Deductible met but OOP not met - patient pays coinsurance
        if (activity.countsTowardOutOfPocket !== false) {
          individualOOP += patientCost;
        }
      }
      // If OOP is met, patient pays $0, so nothing to track
    }
  }

  return {
    individualDeductible,
    individualOOP,
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
