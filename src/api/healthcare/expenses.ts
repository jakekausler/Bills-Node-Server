import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';
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
};

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

  // Collect all healthcare expenses
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

      // Build expense record
      const expense: HealthcareExpense = {
        id: activity.id,
        date: typeof activity.date === 'string' ? activity.date : dayjs(activity.date).format('YYYY-MM-DD'),
        name: activity.name,
        person: activity.healthcarePerson || 'Unknown',
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
      };

      expenses.push(expense);
    }
  }

  // Sort by date (most recent first)
  expenses.sort((a, b) => {
    const dateA = dayjs.utc(a.date).valueOf();
    const dateB = dayjs.utc(b.date).valueOf();
    return dateB - dateA;
  });

  return expenses;
}
