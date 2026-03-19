import { readFileSync } from 'fs';
import { join } from 'path';

const RESULTS_FILE = join(__dirname, '../../.e2e-results.json');

type Simulation = 'default' | 'conservative';

interface SerializedResults {
  default: SerializedAccountsAndTransfers;
  conservative: SerializedAccountsAndTransfers;
}

interface SerializedAccountsAndTransfers {
  accounts: SerializedAccount[];
  transfers: {
    activity: any[];
    bills: any[];
  };
}

interface SerializedAccount {
  name: string;
  consolidatedActivity: SerializedConsolidatedActivity[];
  [key: string]: any;
}

interface SerializedConsolidatedActivity {
  name: string;
  date: string;
  amount: number;
  balance: number;
  isHealthcare?: boolean;
  healthcarePerson?: string | null;
  spendingCategory?: string | null;
  [key: string]: any;
}

let cachedResults: SerializedResults | null = null;

function loadResults(): SerializedResults {
  if (!cachedResults) {
    const raw = readFileSync(RESULTS_FILE, 'utf-8');
    cachedResults = JSON.parse(raw);
  }
  return cachedResults!;
}

export function normalizeDate(d: string): string {
  return d.substring(0, 10); // ISO string to YYYY-MM-DD
}

export function getDefaultResult(): SerializedAccountsAndTransfers {
  return loadResults().default;
}

export function getConservativeResult(): SerializedAccountsAndTransfers {
  return loadResults().conservative;
}

function getResult(simulation: Simulation = 'default'): SerializedAccountsAndTransfers {
  const results = loadResults();
  return simulation === 'conservative' ? results.conservative : results.default;
}

export function getAccountByName(
  name: string,
  simulation: Simulation = 'default',
): SerializedAccount {
  const result = getResult(simulation);
  const account = result.accounts.find((a) => a.name === name);
  if (!account) {
    throw new Error(
      `Account "${name}" not found in ${simulation} simulation. Available: ${result.accounts.map((a) => a.name).join(', ')}`,
    );
  }
  return account;
}

export function getActivities(
  accountName: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  const account = getAccountByName(accountName, simulation);
  return account.consolidatedActivity ?? [];
}

export function getActivitiesByName(
  accountName: string,
  activityName: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  return getActivities(accountName, simulation).filter((a) => a.name === activityName);
}

export function getActivitiesInDateRange(
  accountName: string,
  startDate: string,
  endDate: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  const start = normalizeDate(startDate);
  const end = normalizeDate(endDate);
  return getActivities(accountName, simulation).filter((a) => {
    const d = normalizeDate(a.date);
    return d >= start && d <= end;
  });
}

export function getBalanceOnDate(
  accountName: string,
  date: string,
  simulation: Simulation = 'default',
): number {
  const target = normalizeDate(date);
  const activities = getActivities(accountName, simulation);
  let lastBalance = 0;
  for (const a of activities) {
    if (normalizeDate(a.date) > target) break;
    lastBalance = a.balance;
  }
  return lastBalance;
}

export function getHealthcareActivities(
  accountName: string,
  person: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  return getActivities(accountName, simulation).filter(
    (a) => a.isHealthcare && a.healthcarePerson === person,
  );
}

export function getSpendingTrackerActivities(
  accountName: string,
  category: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  return getActivities(accountName, simulation).filter(
    (a) => a.spendingCategory === category,
  );
}

export function getActivitiesInMonth(
  accountName: string,
  yearMonth: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  const [year, month] = yearMonth.split('-');
  const startDate = `${year}-${month}-01`;
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  return getActivitiesInDateRange(accountName, startDate, endDate, simulation);
}

export function getMonthEndBalance(
  accountName: string,
  yearMonth: string,
  simulation: Simulation = 'default',
): number {
  const [year, month] = yearMonth.split('-');
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const endDate = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
  return getBalanceOnDate(accountName, endDate, simulation);
}

export function getYTDIncome(
  accountName: string,
  year: number,
  throughMonth: number,
  simulation: Simulation = 'default',
): number {
  const startDate = `${year}-01-01`;
  const lastDay = new Date(year, throughMonth, 0).getDate();
  const endDate = `${year}-${String(throughMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const activities = getActivitiesInDateRange(accountName, startDate, endDate, simulation);
  return activities
    .filter(
      (a) =>
        a.amount > 0 &&
        (a.name.includes('Paycheck') ||
          a.name.includes('Pension') ||
          a.name.includes('Social Security') ||
          a.name.includes('Interest')),
    )
    .reduce((sum, a) => sum + a.amount, 0);
}

export function getYTDContributions(
  accountName: string,
  year: number,
  throughMonth: number,
  simulation: Simulation = 'default',
): number {
  const startDate = `${year}-01-01`;
  const lastDay = new Date(year, throughMonth, 0).getDate();
  const endDate = `${year}-${String(throughMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  const activities = getActivitiesInDateRange(accountName, startDate, endDate, simulation);
  return activities
    .filter((a) => a.amount > 0 && a.name.includes('Contribution'))
    .reduce((sum, a) => sum + a.amount, 0);
}

export function getHealthcareSpentThrough(
  person: string,
  date: string,
  simulation: Simulation = 'default',
): { totalPatientCost: number } {
  const result = simulation === 'default' ? getDefaultResult() : getConservativeResult();
  let totalPatientCost = 0;
  for (const account of result.accounts) {
    const activities = account.consolidatedActivity.filter(
      (a) => a.isHealthcare && a.healthcarePerson === person && normalizeDate(a.date) <= date,
    );
    totalPatientCost += activities.reduce((sum, a) => sum + Math.abs(a.amount), 0);
  }
  return { totalPatientCost };
}

export function getRothConversions(
  year: number,
  simulation: Simulation = 'default',
): Array<{ source: string; amount: number; date: string }> {
  const result = simulation === 'default' ? getDefaultResult() : getConservativeResult();
  const conversions: Array<{ source: string; amount: number; date: string }> = [];
  for (const account of result.accounts) {
    const conversionActivities = account.consolidatedActivity.filter(
      (a) =>
        normalizeDate(a.date).startsWith(`${year}`) &&
        a.name.toLowerCase().includes('roth') &&
        a.name.toLowerCase().includes('conversion'),
    );
    for (const a of conversionActivities) {
      conversions.push({
        source: account.name,
        amount: a.amount,
        date: normalizeDate(a.date),
      });
    }
  }
  return conversions;
}

export function getAutoPushPullActivities(
  accountName: string,
  yearMonth: string,
  simulation: Simulation = 'default',
): SerializedConsolidatedActivity[] {
  const activities = getActivitiesInMonth(accountName, yearMonth, simulation);
  return activities.filter(
    (a) =>
      a.name.includes('Auto Push') ||
      a.name.includes('Auto Pull') ||
      a.name.includes('auto push') ||
      a.name.includes('auto pull'),
  );
}

export function getAccountNames(simulation: Simulation = 'default'): string[] {
  const result = simulation === 'default' ? getDefaultResult() : getConservativeResult();
  return result.accounts.map((a) => a.name);
}

export function getTaxPayments(
  year: number,
  simulation: Simulation = 'default',
): Array<{ accountName: string; amount: number; date: string }> {
  const result = simulation === 'default' ? getDefaultResult() : getConservativeResult();
  const payments: Array<{ accountName: string; amount: number; date: string }> = [];
  for (const account of result.accounts) {
    const taxActivities = account.consolidatedActivity.filter(
      (a) =>
        normalizeDate(a.date).startsWith(`${year}`) &&
        a.name.toLowerCase().includes('tax') &&
        a.amount < 0,
    );
    for (const a of taxActivities) {
      payments.push({ accountName: account.name, amount: a.amount, date: normalizeDate(a.date) });
    }
  }
  return payments;
}
