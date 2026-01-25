import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';
import { HealthcareConfig } from '../../data/healthcare/types.d';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
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
 * Determine which plan year a given date falls into based on reset date.
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
  allExpenses: ConsolidatedActivity[],
  billLookup: Map<string, number>
): {
  individualDeductibleRemaining: number;
  familyDeductibleRemaining: number;
  individualOOPRemaining: number;
  familyOOPRemaining: number;
} {
  // Calculate plan year boundaries
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

  console.log('[CALC-DEBUG] ===== Starting calculateRemainingAmounts =====');
  console.log('[CALC-DEBUG] Current expense:', {
    id: expense.id,
    date: expense.date,
    person: expense.healthcarePerson,
    amount: expense.amount,
    billId: expense.billId
  });
  console.log('[CALC-DEBUG] Plan year:', planYear);
  console.log('[CALC-DEBUG] Plan year boundaries:', {
    start: planYearStart.toISOString(),
    end: planYearEnd.toISOString()
  });
  console.log('[CALC-DEBUG] Config:', {
    resetMonth: config.resetMonth,
    resetDay: config.resetDay,
    individualDeductible: config.individualDeductible,
    familyDeductible: config.familyDeductible,
    individualOOPMax: config.individualOutOfPocketMax,
    familyOOPMax: config.familyOutOfPocketMax,
    coveredPersons: config.coveredPersons
  });

  // Track spending per person and for family
  const personSpending = new Map<string, { deductible: number; oop: number }>();
  if (config.coveredPersons) {
    for (const person of config.coveredPersons) {
      personSpending.set(person, { deductible: 0, oop: 0 });
    }
  }
  let familyDeductibleSpent = 0;
  let familyOOPSpent = 0;

  // Process all expenses up to but NOT including current expense chronologically
  console.log('[CALC-DEBUG] Filtering expenses...');
  console.log('[CALC-DEBUG] Total expenses to filter:', allExpenses.length);

  // First, sort ALL expenses with stable ordering (date, then name)
  const sortedExpenses = allExpenses
    .filter(e => {
      const eDate = dayjs.utc(e.date).toDate();
      const isHealthcare = e.isHealthcare;
      const hasPerson = !!e.healthcarePerson;
      const isCovered = config.coveredPersons?.includes(e.healthcarePerson || '');
      const afterStart = eDate >= planYearStart;
      const beforeEnd = eDate < planYearEnd;

      return isHealthcare && hasPerson && isCovered && afterStart && beforeEnd;
    })
    .sort((a, b) => {
      const dateA = dayjs.utc(a.date).valueOf();
      const dateB = dayjs.utc(b.date).valueOf();
      if (dateA !== dateB) {
        return dateA - dateB;
      }
      // Stable tiebreaker: use expense name (or id if names are identical)
      const nameCompare = a.name.localeCompare(b.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return a.id.localeCompare(b.id);
    });

  // Find the index of the current expense in sorted list
  const currentExpenseIndex = sortedExpenses.findIndex(e => e.id === expense.id);

  if (currentExpenseIndex === -1) {
    console.log('[CALC-DEBUG] WARNING: Current expense not found in sorted list!');
    console.log('[CALC-DEBUG] Current expense ID:', expense.id);
  }

  // Only process expenses BEFORE the current expense (0 to currentExpenseIndex-1)
  const relevantExpenses = currentExpenseIndex === -1
    ? [] // If not found, don't process any (safety fallback)
    : sortedExpenses.slice(0, currentExpenseIndex);

  console.log('[CALC-DEBUG] Sorted expenses count:', sortedExpenses.length);
  console.log('[CALC-DEBUG] Current expense index:', currentExpenseIndex);
  console.log('[CALC-DEBUG] Relevant expenses count (before current):', relevantExpenses.length);
  console.log('[CALC-DEBUG] Expense processing order (only those BEFORE current):', relevantExpenses.map(e => ({
    id: e.id,
    date: e.date,
    name: e.name,
    person: e.healthcarePerson,
    amount: e.amount
  })));

  // Process each expense to build running totals
  console.log('[CALC-DEBUG] ----- Starting expense processing loop -----');
  let expenseIndex = 0;
  for (const e of relevantExpenses) {
    expenseIndex++;
    const person = e.healthcarePerson!;
    const personData = personSpending.get(person)!;

    const patientCost = Math.abs(Number(e.amount));
    const billAmount = e.billId ? (billLookup.get(e.billId) || 0) : patientCost;

    console.log(`[CALC-DEBUG] --- Processing expense ${expenseIndex}/${relevantExpenses.length} ---`);
    console.log('[CALC-DEBUG] Expense details:', {
      id: e.id,
      date: e.date,
      person: person,
      patientCost: patientCost,
      billAmount: billAmount,
      billId: e.billId,
      copayAmount: e.copayAmount,
      coinsurancePercent: e.coinsurancePercent,
      countsTowardDeductible: e.countsTowardDeductible,
      countsTowardOutOfPocket: e.countsTowardOutOfPocket
    });
    console.log('[CALC-DEBUG] Running totals BEFORE processing:', {
      personDeductible: personData.deductible,
      personOOP: personData.oop,
      familyDeductible: familyDeductibleSpent,
      familyOOP: familyOOPSpent
    });

    // Check if this is a copay-based expense
    const hasCopay = e.copayAmount !== null && e.copayAmount !== undefined && e.copayAmount > 0;

    console.log('[CALC-DEBUG] Expense type:', hasCopay ? 'COPAY-BASED' : 'DEDUCTIBLE/COINSURANCE-BASED');

    if (hasCopay) {
      // Copay-based expense
      console.log('[CALC-DEBUG] Processing copay expense...');
      if (e.countsTowardDeductible !== false) {
        personData.deductible += billAmount;
        familyDeductibleSpent += billAmount;
        console.log('[CALC-DEBUG] Applied to deductible:', billAmount);
      }
      if (e.countsTowardOutOfPocket !== false) {
        personData.oop += Math.abs(e.copayAmount);
        familyOOPSpent += Math.abs(e.copayAmount);
        console.log('[CALC-DEBUG] Applied to OOP:', Math.abs(e.copayAmount));
      }
    } else {
      // Deductible/coinsurance-based expense
      const deductibleMet = personData.deductible >= config.individualDeductible;
      const oopMet = personData.oop >= config.individualOutOfPocketMax;

      console.log('[CALC-DEBUG] Processing deductible/coinsurance expense...');
      console.log('[CALC-DEBUG] Status checks:', {
        deductibleMet: deductibleMet,
        oopMet: oopMet,
        deductibleAmount: personData.deductible,
        deductibleLimit: config.individualDeductible,
        oopAmount: personData.oop,
        oopLimit: config.individualOutOfPocketMax
      });

      if (!deductibleMet) {
        const remainingDeductible = config.individualDeductible - personData.deductible;
        const amountToDeductible = Math.min(billAmount, remainingDeductible);

        console.log('[CALC-DEBUG] Deductible NOT met - processing...');
        console.log('[CALC-DEBUG] Remaining deductible:', remainingDeductible);

        if (billAmount <= remainingDeductible) {
          // Entire bill is within deductible
          console.log('[CALC-DEBUG] Case: Entire bill within deductible');
          if (e.countsTowardDeductible !== false) {
            personData.deductible += amountToDeductible;
            familyDeductibleSpent += amountToDeductible;
            console.log('[CALC-DEBUG] Applied to deductible:', amountToDeductible);
          }
          if (e.countsTowardOutOfPocket !== false) {
            personData.oop += patientCost;
            familyOOPSpent += patientCost;
            console.log('[CALC-DEBUG] Applied to OOP:', patientCost);
          }
        } else {
          // Bill exceeds remaining deductible
          const coinsurancePercent = e.coinsurancePercent || 0;
          const amountAfterDeductible = billAmount - remainingDeductible;
          const coinsuranceOnRemainder = amountAfterDeductible * (coinsurancePercent / 100);
          const totalPatientPays = remainingDeductible + coinsuranceOnRemainder;

          console.log('[CALC-DEBUG] Case: Bill exceeds remaining deductible');
          console.log('[CALC-DEBUG] Calculation breakdown:', {
            billAmount: billAmount,
            remainingDeductible: remainingDeductible,
            amountAfterDeductible: amountAfterDeductible,
            coinsurancePercent: coinsurancePercent,
            coinsuranceOnRemainder: coinsuranceOnRemainder,
            totalPatientPays: totalPatientPays
          });

          if (e.countsTowardDeductible !== false) {
            personData.deductible += remainingDeductible;
            familyDeductibleSpent += remainingDeductible;
            console.log('[CALC-DEBUG] Applied to deductible:', remainingDeductible);
          }
          if (e.countsTowardOutOfPocket !== false) {
            personData.oop += totalPatientPays;
            familyOOPSpent += totalPatientPays;
            console.log('[CALC-DEBUG] Applied to OOP:', totalPatientPays);
          }
        }
      } else if (!oopMet) {
        // Deductible met but OOP not met
        console.log('[CALC-DEBUG] Case: Deductible met, OOP not met');
        if (e.countsTowardOutOfPocket !== false) {
          personData.oop += patientCost;
          familyOOPSpent += patientCost;
          console.log('[CALC-DEBUG] Applied to OOP:', patientCost);
        }
      } else {
        console.log('[CALC-DEBUG] Case: BOTH deductible and OOP met - NO CHARGES APPLIED');
        console.log('[CALC-DEBUG] Patient cost should be $0, but calculated as:', patientCost);
      }
    }

    console.log('[CALC-DEBUG] Running totals AFTER processing:', {
      personDeductible: personData.deductible,
      personOOP: personData.oop,
      familyDeductible: familyDeductibleSpent,
      familyOOP: familyOOPSpent
    });
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

  console.log('[CALC-DEBUG] ===== Final calculated remaining amounts =====');
  console.log('[CALC-DEBUG] Person:', person);
  console.log('[CALC-DEBUG] Result:', result);
  console.log('[CALC-DEBUG] Final spending:', {
    personDeductible: personData.deductible,
    personOOP: personData.oop,
    familyDeductible: familyDeductibleSpent,
    familyOOP: familyOOPSpent
  });
  console.log('[CALC-DEBUG] ===== End calculateRemainingAmounts =====\n');

  return result;
}

/**
 * Find HSA reimbursement for a healthcare expense.
 * Matches by date, amount, and transfer destination account.
 */
function findHSAReimbursement(
  expense: { date: string; patientCost: number },
  accountId: string,
  allAccounts: any[]
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

  // First, collect ALL healthcare activities (not just filtered ones)
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

  // Collect healthcare expenses with remaining amounts
  const expenses: HealthcareExpense[] = [];

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
      const activityDate = dayjs(activity.date).startOf('day');
      const filterStart = filterStartDate ? dayjs(filterStartDate).startOf('day') : null;
      const filterEnd = filterEndDate ? dayjs(filterEndDate).startOf('day') : null;

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
          allHealthcareActivities,
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
          calculatedData.accounts
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
  console.log('[SORT-DEBUG] Before sort, first 5 expenses:', expenses.slice(0, 5).map(e => ({ date: e.date, name: e.name, id: e.id.substring(0, 8) })));
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
  console.log('[SORT-DEBUG] After sort, first 5 expenses:', expenses.slice(0, 5).map(e => ({ date: e.date, name: e.name, id: e.id.substring(0, 8) })));

  return expenses;
}
