import { Request } from 'express';
import { getHealthcareExpenses, HealthcareExpense } from './expenses';
import { loadAllHealthcareConfigs } from '../../utils/io/virtualHealthcarePlans';

export type ExpenseHistoryDataPoint = {
  date: string;
  personName: string | null; // null = family level, person name = individual
  totalPatientCost: number;
  totalHsaReimbursed: number;
  netCost: number;
  expenseCount: number;
};

export async function getHealthcareExpenseHistory(
  request: Request
): Promise<ExpenseHistoryDataPoint[]> {
  // Get query params
  const configId = request.query.configId as string;
  const simulation = (request.query.simulation as string) || 'Default';

  if (!configId) {
    throw new Error('configId query parameter is required');
  }

  // Load configs to get covered persons (including virtual plans)
  const configs = loadAllHealthcareConfigs(simulation);
  const config = configs.find(c => c.id === configId);
  if (!config) {
    throw new Error(`Healthcare config with id ${configId} not found`);
  }

  // Get expenses using existing endpoint logic
  // TODO (tech debt - no tracker item): This redundant call to getHealthcareExpenses is known and acceptable for now.
  // Each endpoint (expenseHistory, progressHistory) needs the expenses data independently.
  // Future refactoring could extract this to a shared service layer.
  const expenses = await getHealthcareExpenses(request);

  // Filter to only expenses for people in this config
  const configExpenses = expenses.filter(e =>
    config.coveredPersons?.includes(e.person)
  );

  if (configExpenses.length === 0) {
    return [];
  }

  // Group by date AND person, accumulate costs per (date, person) pair
  const byDateAndPerson = new Map<string, ExpenseHistoryDataPoint>();
  // Also group by date only for family-level aggregates
  const byDate = new Map<string, ExpenseHistoryDataPoint>();

  for (const expense of configExpenses) {
    // Per-person aggregation
    const personKey = `${expense.date}|${expense.person}`;
    const personPoint = byDateAndPerson.get(personKey);
    if (personPoint) {
      personPoint.totalPatientCost += expense.patientCost;
      personPoint.totalHsaReimbursed += expense.hsaReimbursed;
      personPoint.netCost = personPoint.totalPatientCost - personPoint.totalHsaReimbursed;
      personPoint.expenseCount += 1;
    } else {
      byDateAndPerson.set(personKey, {
        date: expense.date,
        personName: expense.person,
        totalPatientCost: expense.patientCost,
        totalHsaReimbursed: expense.hsaReimbursed,
        netCost: expense.patientCost - expense.hsaReimbursed,
        expenseCount: 1,
      });
    }

    // Family-level aggregation
    const familyPoint = byDate.get(expense.date);
    if (familyPoint) {
      familyPoint.totalPatientCost += expense.patientCost;
      familyPoint.totalHsaReimbursed += expense.hsaReimbursed;
      familyPoint.netCost = familyPoint.totalPatientCost - familyPoint.totalHsaReimbursed;
      familyPoint.expenseCount += 1;
    } else {
      byDate.set(expense.date, {
        date: expense.date,
        personName: null,
        totalPatientCost: expense.patientCost,
        totalHsaReimbursed: expense.hsaReimbursed,
        netCost: expense.patientCost - expense.hsaReimbursed,
        expenseCount: 1,
      });
    }
  }

  // Combine family and per-person data points
  const result: ExpenseHistoryDataPoint[] = [
    ...byDate.values(),
    ...byDateAndPerson.values(),
  ];

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
