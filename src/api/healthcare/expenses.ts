import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';
import { HealthcareConfig } from '../../data/healthcare/types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Account } from '../../data/account/account';
import { getPlanYear } from './utils';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export type HealthcareExpense = {
  id: string;
  date: string;
  name: string;
  person: string;
  billAmount: number;
  patientCost: number;
  copay: number | null;
  coinsurance: number | null;
  hsaReimbursed: number;
  accountName: string;
  isBill: boolean;
  billId: string | null;
  individualDeductibleRemaining: number;
  familyDeductibleRemaining: number;
  individualOOPRemaining: number;
  familyOOPRemaining: number;
};

/**
 * Find which config applies to a person at a given date.
 */
function findApplicableConfig(
  person: string,
  date: Date,
  configs: HealthcareConfig[]
): HealthcareConfig | null {
  for (const config of configs) {
    // Check if person is covered
    if (!config.coveredPersons?.includes(person)) {
      continue;
    }

    // Check if date is within config period
    const startDate = dayjs.utc(config.startDate).toDate();
    const endDate = config.endDate ? dayjs.utc(config.endDate).toDate() : null;

    if (date < startDate) {
      continue;
    }

    if (endDate && date > endDate) {
      continue;
    }

    return config;
  }

  return null;
}

/**
 * Calculate remaining deductible and OOP amounts for an expense.
 * This processes expenses chronologically to track running totals.
 */
function calculateRemainingAmounts(
  expense: ConsolidatedActivity,
  expenseDate: Date,
  config: HealthcareConfig,
  planYear: number,
  sortedExpenses: ConsolidatedActivity[],
  billLookup: Map<string, number>
): {
  individualDeductibleRemaining: number;
  familyDeductibleRemaining: number;
  individualOOPRemaining: number;
  familyOOPRemaining: number;
} {
  // Calculate plan year boundaries
  const planYearStart = dayjs.utc(`${planYear}-${String(config.resetMonth + 1).padStart(2, '0')}-${String(config.resetDay).padStart(2, '0')}`)
    .startOf('day')
    .toDate();
  const planYearEnd = dayjs.utc(`${planYear + 1}-${String(config.resetMonth + 1).padStart(2, '0')}-${String(config.resetDay).padStart(2, '0')}`)
    .startOf('day')
    .toDate();

  // Track spending per person and for family
  const personSpending = new Map<string, { deductible: number; oop: number }>();
  if (config.coveredPersons) {
    for (const person of config.coveredPersons) {
      personSpending.set(person, { deductible: 0, oop: 0 });
    }
  }
  let familyDeductibleSpent = 0;
  let familyOOPSpent = 0;

  // Filter sorted expenses for this plan year and config
  const relevantSortedExpenses = sortedExpenses
    .filter(e => {
      const eDate = dayjs.utc(e.date).toDate();
      const isHealthcare = e.isHealthcare;
      const hasPerson = !!e.healthcarePerson;
      const isCovered = config.coveredPersons?.includes(e.healthcarePerson || '');
      const afterStart = eDate >= planYearStart;
      const beforeEnd = eDate < planYearEnd;

      return isHealthcare && hasPerson && isCovered && afterStart && beforeEnd;
    });

  // Find the index of the current expense in filtered sorted list
  const currentExpenseIndex = relevantSortedExpenses.findIndex(e => e.id === expense.id);

  // Only process expenses BEFORE the current expense (0 to currentExpenseIndex-1)
  const expensesToProcess = currentExpenseIndex === -1
    ? [] // If not found, don't process any (safety fallback)
    : relevantSortedExpenses.slice(0, currentExpenseIndex);

  // Process each expense to build running totals
  for (const e of expensesToProcess) {
    const person = e.healthcarePerson!;
    const personData = personSpending.get(person)!;

    const patientCost = Math.abs(Number(e.amount));
    const billAmount = e.billId ? (billLookup.get(e.billId) || 0) : patientCost;

    // Check if this is a copay-based expense
    const hasCopay = e.copayAmount !== null && e.copayAmount !== undefined && e.copayAmount > 0;

    if (hasCopay) {
      // Copay-based expense
      if (e.countsTowardDeductible !== false) {
        personData.deductible += billAmount;
        familyDeductibleSpent += billAmount;
      }
      if (e.countsTowardOutOfPocket !== false) {
        personData.oop += Math.abs(e.copayAmount || 0);
        familyOOPSpent += Math.abs(e.copayAmount || 0);
      }
    } else {
      // Deductible/coinsurance-based expense
      const deductibleMet = personData.deductible >= config.individualDeductible;
      const oopMet = personData.oop >= config.individualOutOfPocketMax;

      if (!deductibleMet) {
        const remainingDeductible = config.individualDeductible - personData.deductible;
        const amountToDeductible = Math.min(billAmount, remainingDeductible);

        if (billAmount <= remainingDeductible) {
          // Entire bill is within deductible
          if (e.countsTowardDeductible !== false) {
            personData.deductible += amountToDeductible;
            familyDeductibleSpent += amountToDeductible;
          }
          if (e.countsTowardOutOfPocket !== false) {
            personData.oop += patientCost;
            familyOOPSpent += patientCost;
          }
        } else {
          // Bill exceeds remaining deductible
          const coinsurancePercent = e.coinsurancePercent || 0;
          const amountAfterDeductible = billAmount - remainingDeductible;
          const coinsuranceOnRemainder = amountAfterDeductible * (coinsurancePercent / 100);
          const totalPatientPays = remainingDeductible + coinsuranceOnRemainder;

          if (e.countsTowardDeductible !== false) {
            personData.deductible += remainingDeductible;
            familyDeductibleSpent += remainingDeductible;
          }
          if (e.countsTowardOutOfPocket !== false) {
            personData.oop += totalPatientPays;
            familyOOPSpent += totalPatientPays;
          }
        }
      } else if (!oopMet) {
        // Deductible met but OOP not met
        if (e.countsTowardOutOfPocket !== false) {
          personData.oop += patientCost;
          familyOOPSpent += patientCost;
        }
      }
    }

  }

  // Calculate remaining amounts for the person of this expense
  const person = expense.healthcarePerson!;
  const personData = personSpending.get(person) || { deductible: 0, oop: 0 };

  const result = {
    individualDeductibleRemaining: Math.max(0, config.individualDeductible - personData.deductible),
    familyDeductibleRemaining: Math.max(0, config.familyDeductible - familyDeductibleSpent),
    individualOOPRemaining: Math.max(0, config.individualOutOfPocketMax - personData.oop),
    familyOOPRemaining: Math.max(0, config.familyOutOfPocketMax - familyOOPSpent),
  };

  return result;
}

/**
 * Find HSA reimbursement for a healthcare expense.
 * Matches by date, amount, and transfer destination account.
 * Tracks matched transfer IDs to prevent multiple expenses from matching the same transfer.
 */
function findHSAReimbursement(
  expense: { date: string; patientCost: number },
  accountId: string,
  allAccounts: Account[],
  matchedTransferIds: Set<string>
): number {
  // Look for HSA accounts
  for (const account of allAccounts) {
    if (account.type !== 'HSA' && !account.name.toLowerCase().includes('hsa')) {
      continue;
    }

    if (!account.consolidatedActivity) {
      continue;
    }

    // Look for transfer on same date with matching amount
    for (const activity of account.consolidatedActivity) {
      if (!activity.isTransfer) {
        continue;
      }

      // Skip already-matched transfers
      if (matchedTransferIds.has(activity.id)) {
        continue;
      }

      // Check if transfer goes to the expense account
      // Convert account name to ID before comparing (Fix for Issue #23 Bug #1)
      const toAccountId = allAccounts.find(a => a.name === activity.to)?.id;

      if (toAccountId !== accountId) {
        continue;
      }

      // Check if date matches (allow ±1 day tolerance for timing differences)
      const expenseDate = dayjs.utc(expense.date);
      const transferDate = dayjs.utc(activity.date);
      const daysDiff = Math.abs(expenseDate.diff(transferDate, 'day'));
      if (daysDiff > 1) {
        continue;
      }

      // Check if amount matches (HSA shows negative, expense shows negative, so we compare abs values)
      const transferAmount = Math.abs(Number(activity.amount));
      if (Math.abs(transferAmount - expense.patientCost) < 0.01) {
        matchedTransferIds.add(activity.id);
        return transferAmount;
      }
    }
  }

  return 0;
}

export async function getHealthcareExpenses(
  request: Request
): Promise<HealthcareExpense[]> {
  // Extract query parameters
  const simulation = (request.query.simulation as string) || 'Default';
  const startDateStr = request.query.startDate as string | undefined;
  const endDateStr = request.query.endDate as string | undefined;

  // Load healthcare configurations
  const configs = await loadHealthcareConfigs();

  // Load data and run calculation
  const data = await getData(request);
  const { accountsAndTransfers, startDate, endDate } = data;

  // Run calculation engine to process healthcare expenses
  const calculatedData = await calculateAllActivity(
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

  // Create bill lookup map for original amounts from ALL account bills
  const billLookup = new Map<string, number>();

  // Collect bills from all accounts (this includes healthcare bills stored in account.bills)
  for (const account of accountsAndTransfers.accounts) {
    if (account.bills) {
      for (const bill of account.bills) {
        billLookup.set(bill.id, Math.abs(Number(bill.amount)));
      }
    }
  }

  // Also include bills from transfers.bills (these are typically transfer bills)
  for (const bill of calculatedData.transfers.bills) {
    if (!billLookup.has(bill.id)) {
      billLookup.set(bill.id, Math.abs(Number(bill.amount)));
    }
  }

  // Parse date filters if provided
  const filterStartDate = startDateStr ? dayjs.utc(startDateStr).toDate() : null;
  const filterEndDate = endDateStr ? dayjs.utc(endDateStr).toDate() : null;

  // First, collect ALL healthcare activities and pre-sort them
  // We need all activities to calculate running totals correctly
  const allHealthcareActivities: ConsolidatedActivity[] = [];
  for (const account of calculatedData.accounts) {
    if (!account.consolidatedActivity) {
      continue;
    }
    for (const activity of account.consolidatedActivity) {
      if (activity.isHealthcare) {
        allHealthcareActivities.push(activity);
      }
    }
  }

  // Pre-sort all healthcare activities once (date, name, id)
  const sortedHealthcareActivities = allHealthcareActivities.sort((a, b) => {
    const dateA = dayjs.utc(a.date).valueOf();
    const dateB = dayjs.utc(b.date).valueOf();
    if (dateA !== dateB) {
      return dateA - dateB;
    }
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return a.id.localeCompare(b.id);
  });

  // Collect healthcare expenses with remaining amounts
  const expenses: HealthcareExpense[] = [];
  const matchedTransferIds = new Set<string>();

  for (const account of calculatedData.accounts) {
    if (!account.consolidatedActivity) {
      continue;
    }

    for (const activity of account.consolidatedActivity) {
      // Skip non-healthcare activities
      if (!activity.isHealthcare) {
        continue;
      }

      // Parse activity date using day-based comparison to avoid timezone issues
      const activityDate = dayjs.utc(activity.date).startOf('day');
      const filterStart = filterStartDate ? dayjs.utc(filterStartDate).startOf('day') : null;
      const filterEnd = filterEndDate ? dayjs.utc(filterEndDate).startOf('day') : null;

      // Apply date filter if specified
      if (filterStart && activityDate.isBefore(filterStart)) {
        continue;
      }
      if (filterEnd && activityDate.isAfter(filterEnd)) {
        continue;
      }

      // Find applicable config for this expense
      const expenseDate = dayjs.utc(activity.date).toDate();
      const person = activity.healthcarePerson || 'Unknown';
      const config = findApplicableConfig(person, expenseDate, configs);

      // Calculate remaining amounts (default to 0 if no config)
      let remainingAmounts = {
        individualDeductibleRemaining: 0,
        familyDeductibleRemaining: 0,
        individualOOPRemaining: 0,
        familyOOPRemaining: 0,
      };

      if (config) {
        const planYear = getPlanYear(expenseDate, config.resetMonth, config.resetDay);
        remainingAmounts = calculateRemainingAmounts(
          activity,
          expenseDate,
          config,
          planYear,
          sortedHealthcareActivities,
          billLookup
        );
      }

      // Build expense record
      const expense: HealthcareExpense = {
        id: activity.id,
        date: typeof activity.date === 'string' ? activity.date : dayjs(activity.date).format('YYYY-MM-DD'),
        name: activity.name,
        person: person,
        billAmount: activity.billId ? (billLookup.get(activity.billId) ?? 0) : Math.abs(Number(activity.amount)),
        patientCost: Math.abs(Number(activity.amount)),
        copay: activity.copayAmount ?? null,
        coinsurance: activity.coinsurancePercent ?? null,
        hsaReimbursed: findHSAReimbursement(
          { date: typeof activity.date === 'string' ? activity.date : dayjs(activity.date).format('YYYY-MM-DD'), patientCost: Math.abs(Number(activity.amount)) },
          account.id,
          calculatedData.accounts,
          matchedTransferIds
        ),
        accountName: account.name,
        isBill: activity.billId !== null && activity.billId !== undefined,
        billId: activity.billId ?? null,
        individualDeductibleRemaining: remainingAmounts.individualDeductibleRemaining,
        familyDeductibleRemaining: remainingAmounts.familyDeductibleRemaining,
        individualOOPRemaining: remainingAmounts.individualOOPRemaining,
        familyOOPRemaining: remainingAmounts.familyOOPRemaining,
      };

      expenses.push(expense);
    }
  }

  // Sort by date (ascending - January first), then by name ascending, then by id ascending for stable ordering
  // This matches the processing order used in calculateRemainingAmounts so deductible remaining is descending
  expenses.sort((a, b) => {
    const dateA = dayjs.utc(a.date).valueOf();
    const dateB = dayjs.utc(b.date).valueOf();
    if (dateA !== dateB) {
      return dateA - dateB; // Ascending (January first, December last)
    }
    // For same-day expenses, use the same processing order (name ASC, then id ASC)
    // This makes deductible remaining values descending as you read down
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) {
      return nameCompare;
    }
    return a.id.localeCompare(b.id);
  });

  return expenses;
}
