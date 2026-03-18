import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { getAccountsAndTransfers } from '../utils/io/accountsAndTransfers';
import { calculateAllActivity } from '../utils/calculate-v3/engine';

const RESULTS_FILE = join(__dirname, '../../.e2e-results.json');

export async function setup() {
  console.log('[E2E] Loading data for Default simulation...');
  const defaultData = getAccountsAndTransfers('Default');

  console.log('[E2E] Loading data for Conservative simulation...');
  const conservativeData = getAccountsAndTransfers('Conservative');

  const startDate = new Date('2025-01-01');
  const endDate = new Date('2055-12-31');

  console.log('[E2E] Running engine for Default simulation (2025-2055)...');
  const defaultResult = await calculateAllActivity(
    defaultData,
    startDate,
    endDate,
    'Default',
    false, // monteCarlo
    0,     // simulationNumber
    0,     // totalSimulations
    true,  // forceRecalculation
    false, // enableLogging
  );

  console.log('[E2E] Running engine for Conservative simulation (2025-2055)...');
  const conservativeResult = await calculateAllActivity(
    conservativeData,
    startDate,
    endDate,
    'Conservative',
    false,
    0,
    0,
    true,
    false,
  );

  // Serialize results — accounts have a serialize() method
  const results = {
    default: {
      accounts: defaultResult.accounts.map((a) => a.serialize(true)),
      transfers: {
        activity: defaultResult.transfers.activity.map((a) => a.serialize()),
        bills: defaultResult.transfers.bills.map((b) => b.serialize()),
      },
    },
    conservative: {
      accounts: conservativeResult.accounts.map((a) => a.serialize(true)),
      transfers: {
        activity: conservativeResult.transfers.activity.map((a) => a.serialize()),
        bills: conservativeResult.transfers.bills.map((b) => b.serialize()),
      },
    },
  };

  console.log(`[E2E] Default: ${defaultResult.accounts.length} accounts`);
  console.log(`[E2E] Conservative: ${conservativeResult.accounts.length} accounts`);

  writeFileSync(RESULTS_FILE, JSON.stringify(results));
  console.log(`[E2E] Results saved to ${RESULTS_FILE}`);
}

export async function teardown() {
  if (existsSync(RESULTS_FILE)) {
    unlinkSync(RESULTS_FILE);
    console.log('[E2E] Cleaned up results file');
  }
}
