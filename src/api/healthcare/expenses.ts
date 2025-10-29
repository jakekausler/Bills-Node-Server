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
        date: activity.date,
        name: activity.name,
        person: activity.healthcarePerson || 'Unknown',
        billAmount: 0, // TODO: Get original bill amount (not yet available in data)
        patientCost: Math.abs(activity.amount), // Convert negative expense to positive
        copay: activity.copayAmount ?? null,
        coinsurance: activity.coinsurancePercent ?? null,
        hsaReimbursed: 0, // TODO: Match HSA reimbursements
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
