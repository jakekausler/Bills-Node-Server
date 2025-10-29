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
      if (activity.to !== accountId) {
        continue;
      }

      // Check if date matches (allow same day)
      if (activity.date !== expense.date) {
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

  // Create bill lookup map for original amounts
  const billLookup = new Map<string, number>();
  for (const bill of calculatedData.transfers.bills) {
    billLookup.set(bill.id, Math.abs(Number(bill.amount)));
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

      // Parse activity date
      const activityDate = dayjs.utc(activity.date).toDate();

      // Apply date filter if specified
      if (filterStartDate && activityDate < filterStartDate) {
        continue;
      }
      if (filterEndDate && activityDate > filterEndDate) {
        continue;
      }

      // Build expense record
      const expense: HealthcareExpense = {
        id: activity.id,
        date: typeof activity.date === 'string' ? activity.date : dayjs(activity.date).format('YYYY-MM-DD'),
        name: activity.name,
        person: activity.healthcarePerson || 'Unknown',
        billAmount: activity.billId ? (billLookup.get(activity.billId) ?? 0) : 0,
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
