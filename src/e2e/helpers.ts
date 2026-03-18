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

function normalizeDate(d: string): string {
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
