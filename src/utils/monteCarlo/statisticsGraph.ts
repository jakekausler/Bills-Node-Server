import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SimulationResult, FilteredAccount, FilteredActivity } from './types';
import { isSame } from '../date/date';
import { loadData } from '../io/accountsAndTransfers';

dayjs.extend(utc);

export interface PercentileGraphData {
  type: 'percentile';
  labels: string[]; // Years as strings
  datasets: PercentileDataset[];
}

export interface PercentileDataset {
  label: string; // e.g., "0th Percentile", "50th Percentile", "Deterministic"
  data: number[]; // Minimum balance values for each year
  percentile?: number; // The percentile this dataset represents (optional for deterministic)
  isDeterministic?: boolean; // Indicates if this is the deterministic line
  accountId?: string; // The account ID this dataset represents (when not combining accounts)
  accountName?: string; // The account name this dataset represents (when not combining accounts)
}

export interface MonteCarloGraphOptions {
  percentiles?: number[]; // Array of percentiles to calculate
  includeDeterministic?: boolean; // Whether to include a deterministic (non-Monte Carlo) line
  combineAccounts?: boolean; // Whether to combine all accounts (true) or create separate datasets per account (false)
}

interface YearlyMinBalances {
  [year: number]: number; // Minimum balance for that year across all accounts
}

interface YearlyAccountBalances {
  [year: number]: { [accountId: string]: number }; // Minimum balance for each account by year
}

interface SimulationYearlyData {
  simulationNumber: number;
  yearlyMinBalances: YearlyMinBalances;
  yearlyAccountBalances?: YearlyAccountBalances;
}

/**
 * Calculates the minimum daily balance across all accounts for each year in a simulation
 * @param accounts - Array of filtered accounts
 * @param separateAccounts - If true, also return per-account yearly minimums
 */
function calculateYearlyMinBalances(
  accounts: FilteredAccount[],
  separateAccounts: boolean = false,
): {
  combined: YearlyMinBalances;
  perAccount?: YearlyAccountBalances;
} {
  const yearlyMinBalances: YearlyMinBalances = {};
  const yearlyAccountBalances: YearlyAccountBalances = {};

  // Create a map to track current balance for each account
  const accountBalances: Record<string, number> = {};
  accounts.forEach((acc) => {
    accountBalances[acc.id] = 0;
  });

  // Create a consolidated list of all activities across all accounts, sorted by date
  const allActivities: (FilteredActivity & { accountId: string; parsedDate: Date })[] = [];

  accounts.forEach((acc) => {
    acc.consolidatedActivity.forEach((activity) => {
      allActivities.push({
        ...activity,
        accountId: acc.id,
        parsedDate: new Date(activity.date),
      });
    });
  });

  // Sort activities by date
  allActivities.sort((a, b) => a.parsedDate.getTime() - b.parsedDate.getTime());

  // Process activities day by day
  let currentDate = allActivities[0]?.parsedDate;
  if (!currentDate) return { combined: yearlyMinBalances };

  const endDate = allActivities[allActivities.length - 1]?.parsedDate;
  if (!endDate) return { combined: yearlyMinBalances };

  let activityIndex = 0;

  while (currentDate.getTime() <= endDate.getTime()) {
    const currentYear = currentDate.getFullYear();

    // Process all activities for this date
    while (activityIndex < allActivities.length && isSame(allActivities[activityIndex].parsedDate, currentDate)) {
      const activity = allActivities[activityIndex];
      accountBalances[activity.accountId] = activity.balance;
      activityIndex++;
    }

    // Calculate total balance across all accounts for this date
    const totalBalance = Object.values(accountBalances).reduce((sum, balance) => sum + balance, 0);

    // Update yearly minimum for combined balances
    if (yearlyMinBalances[currentYear] === undefined) {
      yearlyMinBalances[currentYear] = totalBalance;
    } else {
      yearlyMinBalances[currentYear] = Math.min(yearlyMinBalances[currentYear], totalBalance);
    }

    // Update yearly minimum for individual accounts if requested
    if (separateAccounts) {
      if (!yearlyAccountBalances[currentYear]) {
        yearlyAccountBalances[currentYear] = {};
      }

      accounts.forEach((acc) => {
        const accountBalance = accountBalances[acc.id];
        if (yearlyAccountBalances[currentYear][acc.id] === undefined) {
          yearlyAccountBalances[currentYear][acc.id] = accountBalance;
        } else {
          yearlyAccountBalances[currentYear][acc.id] = Math.min(
            yearlyAccountBalances[currentYear][acc.id],
            accountBalance,
          );
        }
      });
    }

    // Move to next day
    currentDate = dayjs.utc(currentDate).add(1, 'day').toDate();
  }

  return {
    combined: yearlyMinBalances,
    perAccount: separateAccounts ? yearlyAccountBalances : undefined,
  };
}

/**
 * Calculates percentile value from sorted array
 */
function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);

  if (lower === upper) {
    return sortedValues[lower];
  }

  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Processes all simulations to calculate yearly minimum balances
 */
function processAllSimulations(simulationId: string, separateAccounts: boolean = false): SimulationYearlyData[] {
  const resultsPath = join(__dirname, 'results', `${simulationId}.json`);

  try {
    const resultsData = readFileSync(resultsPath, 'utf8');
    const fileData = JSON.parse(resultsData);

    // Check if this is the new format with metadata
    const simulations: SimulationResult[] = fileData.metadata ? fileData.results : fileData;

    return simulations.map((simulation) => {
      const balanceData = calculateYearlyMinBalances(simulation.accounts, separateAccounts);
      return {
        simulationNumber: simulation.simulationNumber,
        yearlyMinBalances: balanceData.combined,
        yearlyAccountBalances: balanceData.perAccount,
      };
    });
  } catch (error) {
    throw new Error(`Failed to load simulation results: ${error}`);
  }
}

/**
 * Runs a deterministic calculation (non-Monte Carlo) to get yearly minimum balances
 */
async function runDeterministicCalculation(
  simulationId: string,
  separateAccounts: boolean = false,
): Promise<{ combined: YearlyMinBalances; perAccount?: YearlyAccountBalances } | null> {
  const resultsPath = join(__dirname, 'results', `${simulationId}.json`);

  try {
    const resultsData = readFileSync(resultsPath, 'utf8');
    const fileData = JSON.parse(resultsData);

    // Get dates from metadata
    if (!fileData.metadata) {
      console.warn('No metadata found in simulation file, skipping deterministic calculation');
      return null;
    }

    const startDate = new Date(fileData.metadata.startDate);
    const endDate = new Date(fileData.metadata.endDate);

    // Run deterministic calculation
    const results = await loadData(
      startDate,
      endDate,
      'Default',
      {},
      {
        monteCarlo: false,
      },
    );

    // Convert to filtered accounts format
    const filteredAccounts: FilteredAccount[] = results.accounts.map(
      (account): FilteredAccount => ({
        name: account.name,
        id: account.id,
        consolidatedActivity: account.consolidatedActivity.map((activity): FilteredActivity => {
          const serialized = activity.serialize();
          return {
            name: serialized.name,
            id: serialized.id,
            amount: typeof serialized.amount === 'number' ? serialized.amount : 0,
            balance: serialized.balance,
            from: serialized.from || '',
            to: serialized.to || '',
            date: serialized.date,
          };
        }),
      }),
    );

    // Calculate yearly minimum balances for deterministic result
    return calculateYearlyMinBalances(filteredAccounts, separateAccounts);
  } catch (error) {
    console.error('Failed to run deterministic calculation:', error);
    return null;
  }
}

/**
 * Generates Monte Carlo statistics graph data showing percentile lines for minimum yearly balances
 * @param simulationId - ID of the completed simulation
 * @param options - Configuration options for the graph generation
 * @returns Graph data formatted for Chart.js consumption
 */
export async function generateMonteCarloStatisticsGraph(
  simulationId: string,
  options: MonteCarloGraphOptions = {},
): Promise<PercentileGraphData> {
  // Destructure options with defaults
  const {
    percentiles = [0, 50, 100],
    includeDeterministic = true,
    combineAccounts = true,
  } = options;

  // Process all simulations to get yearly data
  const simulationData = processAllSimulations(simulationId, !combineAccounts);

  if (simulationData.length === 0) {
    throw new Error('No simulation data found');
  }

  // Collect all unique years across all simulations
  const allYears = new Set<number>();
  simulationData.forEach((sim) => {
    Object.keys(sim.yearlyMinBalances).forEach((year) => {
      allYears.add(parseInt(year));
    });
  });

  // Run deterministic calculation if requested
  let deterministicData: { combined: YearlyMinBalances; perAccount?: YearlyAccountBalances } | null = null;
  if (includeDeterministic) {
    deterministicData = await runDeterministicCalculation(simulationId, !combineAccounts);
    if (deterministicData) {
      // Add years from deterministic calculation to ensure we have all years
      Object.keys(deterministicData.combined).forEach((year) => {
        allYears.add(parseInt(year));
      });
    }
  }

  const sortedYears = Array.from(allYears).sort();
  const labels = sortedYears.map((year) => year.toString());

  // Create datasets
  const datasets: PercentileDataset[] = [];

  if (combineAccounts) {
    // Create datasets for each percentile (combined accounts)
    percentiles.forEach((percentile) => {
      const data: number[] = [];

      // For each year, collect all simulation values and calculate percentile
      sortedYears.forEach((year) => {
        const yearValues: number[] = [];

        simulationData.forEach((sim) => {
          const yearValue = sim.yearlyMinBalances[year];
          if (yearValue !== undefined) {
            yearValues.push(yearValue);
          }
        });

        // Sort values and calculate percentile
        yearValues.sort((a, b) => a - b);
        const percentileValue = calculatePercentile(yearValues, percentile);
        data.push(percentileValue);
      });

      datasets.push({
        label: `${percentile}${getOrdinalSuffix(percentile)} Percentile`,
        data,
        percentile,
      });
    });
  } else {
    // Create datasets for each account and percentile combination
    // First, get all unique account IDs and names from the simulation data
    const accountMap: Map<string, string> = new Map(); // id -> name

    // Get account names from the original simulation results file
    try {
      const resultsPath = join(__dirname, 'results', `${simulationId}.json`);
      const resultsData = readFileSync(resultsPath, 'utf8');
      const fileData = JSON.parse(resultsData);
      const simulations: SimulationResult[] = fileData.metadata ? fileData.results : fileData;

      if (simulations.length > 0) {
        simulations[0].accounts.forEach((account) => {
          accountMap.set(account.id, account.name);
        });
      }
    } catch (error) {
      // Fallback to using account IDs from yearly balance data
      simulationData.forEach((sim) => {
        if (sim.yearlyAccountBalances) {
          Object.keys(sim.yearlyAccountBalances).forEach((year) => {
            Object.keys(sim.yearlyAccountBalances![parseInt(year)]).forEach((accountId) => {
              if (!accountMap.has(accountId)) {
                accountMap.set(accountId, accountId);
              }
            });
          });
        }
      });
    }

    // Create datasets for each account-percentile combination
    accountMap.forEach((accountName, accountId) => {
      percentiles.forEach((percentile) => {
        const data: number[] = [];

        // For each year, collect all simulation values for this account and calculate percentile
        sortedYears.forEach((year) => {
          const yearValues: number[] = [];

          simulationData.forEach((sim) => {
            if (sim.yearlyAccountBalances && sim.yearlyAccountBalances[year]) {
              const yearValue = sim.yearlyAccountBalances[year][accountId];
              if (yearValue !== undefined) {
                yearValues.push(yearValue);
              }
            }
          });

          // Sort values and calculate percentile
          yearValues.sort((a, b) => a - b);
          const percentileValue = calculatePercentile(yearValues, percentile);
          data.push(percentileValue);
        });

        datasets.push({
          label: `${accountName} - ${percentile}${getOrdinalSuffix(percentile)} Percentile`,
          data,
          percentile,
          accountId,
          accountName,
        });
      });
    });
  }

  // Add deterministic line if we have the data
  if (deterministicData) {
    if (combineAccounts) {
      // Single deterministic line for combined accounts
      const deterministicDataset: PercentileDataset = {
        label: 'Deterministic',
        data: sortedYears.map((year) => deterministicData!.combined[year] ?? 0),
        isDeterministic: true,
      };
      datasets.push(deterministicDataset);
    } else {
      // Deterministic line for each account
      if (deterministicData.perAccount) {
        const accountMap: Map<string, string> = new Map();

        // Get account names from the original simulation results file
        try {
          const resultsPath = join(__dirname, 'results', `${simulationId}.json`);
          const resultsData = readFileSync(resultsPath, 'utf8');
          const fileData = JSON.parse(resultsData);
          const simulations: SimulationResult[] = fileData.metadata ? fileData.results : fileData;

          if (simulations.length > 0) {
            simulations[0].accounts.forEach((account) => {
              accountMap.set(account.id, account.name);
            });
          }
        } catch (error) {
          // Fallback to using account IDs from yearly balance data
          Object.keys(deterministicData.perAccount).forEach((year) => {
            Object.keys(deterministicData!.perAccount![parseInt(year)]).forEach((accountId) => {
              if (!accountMap.has(accountId)) {
                accountMap.set(accountId, accountId);
              }
            });
          });
        }

        accountMap.forEach((accountName, accountId) => {
          const deterministicDataset: PercentileDataset = {
            label: `${accountName} - Deterministic`,
            data: sortedYears.map((year) => deterministicData!.perAccount![year]?.[accountId] ?? 0),
            isDeterministic: true,
            accountId,
            accountName,
          };
          datasets.push(deterministicDataset);
        });
      }
    }
  }

  return {
    type: 'percentile',
    labels,
    datasets,
  };
}

/**
 * Helper function to get ordinal suffix for percentiles
 */
function getOrdinalSuffix(num: number): string {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return 'th';
  }

  switch (lastDigit) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}
