import { Request } from 'express';
import { getHealthcareExpenses, HealthcareExpense } from './expenses';
import { loadHealthcareConfigs } from '../../utils/io/healthcareConfigs';

export type ProgressHistoryDataPoint = {
  date: string;
  personName: string | null; // null = family level, "Jake"/"Kendall" = individual
  deductibleSpent: number;
  oopSpent: number;
};

export async function getHealthcareProgressHistory(
  request: Request
): Promise<ProgressHistoryDataPoint[]> {
  // Get query params
  const configId = request.query.configId as string;

  if (!configId) {
    throw new Error('configId query parameter is required');
  }

  // Load configs to get limits
  const configs = await loadHealthcareConfigs();
  const config = configs.find(c => c.id === configId);
  if (!config) {
    throw new Error(`Healthcare config with id ${configId} not found`);
  }

  // Get expenses using existing endpoint logic
  const expenses = await getHealthcareExpenses(request);

  // Filter to only expenses for people in this config
  const configExpenses = expenses.filter(e =>
    config.coveredPersons?.includes(e.person)
  );

  if (configExpenses.length === 0) {
    return [];
  }

  // Group by date AND person, take the last expense per (date, person) pair
  // Expenses are already sorted chronologically by getHealthcareExpenses
  const byDateAndPerson = new Map<string, HealthcareExpense>();
  for (const expense of configExpenses) {
    const key = `${expense.date}|${expense.person}`;
    byDateAndPerson.set(key, expense);
  }

  // Also group by date only for family-level aggregates
  const byDate = new Map<string, HealthcareExpense>();
  for (const expense of configExpenses) {
    byDate.set(expense.date, expense);
  }

  // Transform to progress data points (both per-person and family)
  const result: ProgressHistoryDataPoint[] = [];

  // Add family-level data points
  for (const [date, expense] of byDate) {
    result.push({
      date,
      personName: null,
      deductibleSpent: config.familyDeductible - expense.familyDeductibleRemaining,
      oopSpent: config.familyOutOfPocketMax - expense.familyOOPRemaining,
    });
  }

  // Add per-person data points
  for (const [key, expense] of byDateAndPerson) {
    result.push({
      date: expense.date,
      personName: expense.person,
      deductibleSpent: config.individualDeductible - expense.individualDeductibleRemaining,
      oopSpent: config.individualOutOfPocketMax - expense.individualOOPRemaining,
    });
  }

  // Sort by date, then by personName (nulls first for family)
  result.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;

    // Family (null) comes before individuals
    if (a.personName === null && b.personName !== null) return -1;
    if (a.personName !== null && b.personName === null) return 1;
    if (a.personName === null && b.personName === null) return 0;

    // Both are non-null strings, safe to compare
    return (a.personName as string).localeCompare(b.personName as string);
  });

  return result;
}
