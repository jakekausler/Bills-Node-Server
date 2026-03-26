import { readFileSync } from 'fs';
import { join } from 'path';
import { FilteredAccount, FilteredActivity } from './types';
import { loadData } from '../io/accountsAndTransfers';
import { MC_RESULTS_DIR } from './paths';
import { getLastAssetManager } from '../calculate-v3/engine';

// Module-level cache for deterministic results, keyed by `{startDate}:{endDate}:{simulation}`
// The deterministic result is the same regardless of which account is selected,
// so we cache it separately to avoid re-running the ~17s engine on every account switch.
const detCache = new Map<string, { combined: YearlyMinBalances; perAccount?: YearlyAccountBalances }>();

/**
 * Clear the deterministic results cache (called by /api/cache/clear)
 */
export function clearDetCache(): void {
  detCache.clear();
}

export interface PercentileGraphData {
  type: 'percentile';
  labels: string[]; // Years as strings
  datasets: PercentileDataset[];
  fundedRatio?: number; // #9: % of simulations that never failed
  failedSimulations?: number; // #9: Count of failed simulations
  totalSimulations?: number; // #9: Total simulations run
  medianFailureYear?: number | null; // #9: Median year of failure for failed sims
  worstYear?: { year: number; medianMinBalance: number; realMedianMinBalance: number }; // Year with lowest median balance
  finalYear?: { median: number; p5: number; p25: number; p75: number; p95: number; realMedian: number; realP5: number; realP25: number; realP75: number; realP95: number }; // Stats for last year
  seed?: number; // Base seed used for the simulation
  accountNames?: Array<{ id: string; name: string }>; // Available accounts for per-account filtering
  deathDates?: Array<{ simulationNumber: number; deathDates: Record<string, string | null> }>; // #14: Death dates per simulation for filtering
  survivingOnlyApplied?: boolean; // Whether survivingOnly filtering was applied
}

export interface PercentileDataset {
  label: string; // e.g., "0th Percentile", "50th Percentile", "Deterministic"
  data: number[]; // Minimum balance values for each year
  percentile?: number; // The percentile this dataset represents (optional for deterministic)
  isDeterministic?: boolean; // Indicates if this is the deterministic line
  accountId?: string; // The account ID this dataset represents (when not combining accounts)
  accountName?: string; // The account name this dataset represents (when not combining accounts)
  realValues?: number[]; // Real dollar (inflation-adjusted) values in start-year dollars
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
  cumulativeInflation?: Record<number, number>;
  fundingFailureYear?: number | null; // #9: First year a pull account dropped below minimumBalance
  deathDates?: Record<string, string | null>; // #14: Person name → ISO date or null if alive
}

/**
 * Calculates the minimum balance per account per year, then sums across accounts.
 * This matches Graph View's approach: sum(min per account per year) rather than
 * min(sum across accounts per day), ensuring consistent values between views.
 * @param accounts - Array of filtered accounts
 * @param separateAccounts - If true, also return per-account yearly minimums
 */
export function calculateYearlyMinBalances(
  accounts: FilteredAccount[],
  separateAccounts: boolean = false,
): {
  combined: YearlyMinBalances;
  perAccount?: YearlyAccountBalances;
} {
  const yearlyAccountBalances: YearlyAccountBalances = {};

  // For each account, track its per-year minimum balance independently
  for (const acc of accounts) {
    // Track current balance for this account
    let currentBalance = 0;

    for (const activity of acc.consolidatedActivity) {
      const date = new Date(activity.date);
      const year = date.getUTCFullYear();
      currentBalance = activity.balance;

      // Initialize year entry if needed
      if (!yearlyAccountBalances[year]) {
        yearlyAccountBalances[year] = {};
      }

      // Update per-account yearly minimum
      if (yearlyAccountBalances[year][acc.id] === undefined) {
        yearlyAccountBalances[year][acc.id] = currentBalance;
      } else {
        yearlyAccountBalances[year][acc.id] = Math.min(
          yearlyAccountBalances[year][acc.id],
          currentBalance,
        );
      }
    }
  }

  // Combined = sum of per-account minimums for each year
  const yearlyMinBalances: YearlyMinBalances = {};
  for (const yearStr of Object.keys(yearlyAccountBalances)) {
    const year = parseInt(yearStr);
    yearlyMinBalances[year] = accounts.reduce((sum, acc) => {
      return sum + (yearlyAccountBalances[year][acc.id] ?? 0);
    }, 0);
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
 * Calculate median cumulative inflation for a given year across all simulations
 * Used to deflate nominal values to real (start-year) dollars
 */
function getMedianCumulativeInflationForYear(
  simulationData: SimulationYearlyData[],
  year: number,
): number {
  const inflationValues: number[] = [];

  for (const sim of simulationData) {
    if (sim.cumulativeInflation && sim.cumulativeInflation[year]) {
      inflationValues.push(sim.cumulativeInflation[year]);
    }
  }

  if (inflationValues.length === 0) {
    return 1.0; // No inflation data, return identity
  }

  inflationValues.sort((a, b) => a - b);
  return calculatePercentile(inflationValues, 50); // Median
}

/**
 * Filter out asset account keys from yearlyAccountBalances (keys starting with 'asset:')
 */
function filterOutAssets(yearlyAccountBalances: YearlyAccountBalances): YearlyAccountBalances {
  const filtered: YearlyAccountBalances = {};
  for (const [year, accounts] of Object.entries(yearlyAccountBalances)) {
    filtered[parseInt(year)] = {};
    for (const [accountId, balance] of Object.entries(accounts)) {
      if (!accountId.startsWith('asset:')) {
        filtered[parseInt(year)][accountId] = balance;
      }
    }
  }
  return filtered;
}

/**
 * #14: Check if at least one person is alive at a given year
 * Converts ISO date strings to year and checks if any are >= the given year
 */
function hasAnyoneSurvivingInYear(deathDates: Record<string, string | null> | undefined, year: number): boolean {
  if (!deathDates) return true; // No death data, assume all alive

  for (const [_person, deathDateStr] of Object.entries(deathDates)) {
    // null = alive at end of simulation
    if (deathDateStr === null) {
      return true;
    }
    // Parse death date and check if it occurs after the year
    try {
      const deathYear = parseInt(deathDateStr.substring(0, 4), 10);
      if (deathYear > year) {
        return true; // Someone dies after this year, so they're alive in this year
      }
    } catch {
      // If parsing fails, assume alive
      return true;
    }
  }

  return false; // All persons dead before or during this year
}

/**
 * Processes all simulations to return pre-computed yearly minimum balances
 * Results file now contains aggregated simulation data (yearly min balances only)
 */
function processAllSimulations(simulationId: string, separateAccounts: boolean = false): SimulationYearlyData[] {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

  try {
    const resultsData = readFileSync(resultsPath, 'utf8');
    const fileData = JSON.parse(resultsData);

    // Results file structure: { metadata: {...}, results: [...aggregated data...] }
    const results: SimulationYearlyData[] = fileData.results || [];

    return results.map((result) => ({
      simulationNumber: result.simulationNumber,
      yearlyMinBalances: result.yearlyMinBalances,
      yearlyAccountBalances: separateAccounts ? result.yearlyAccountBalances : undefined,
      cumulativeInflation: result.cumulativeInflation,
      fundingFailureYear: result.fundingFailureYear,
      deathDates: result.deathDates,
    }));
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
  excludeAssets: boolean = false,
): Promise<{ combined: YearlyMinBalances; perAccount?: YearlyAccountBalances } | null> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

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

    // Check detCache — the deterministic result is the same for all accounts,
    // so we always request perAccount data and cache the full result.
    const detCacheKey = `${fileData.metadata.startDate}:${fileData.metadata.endDate}:Default`;
    const cachedDet = detCache.get(detCacheKey);
    if (cachedDet) {
      // Return from cache, filtering perAccount based on caller's needs
      return {
        combined: cachedDet.combined,
        perAccount: separateAccounts ? cachedDet.perAccount : undefined,
      };
    }

    // Run deterministic calculation (uses engine's built-in cache)
    const results = await loadData(
      startDate,
      endDate,
      'Default',
      {},
      {
        monteCarlo: false,
      },
    );

    // Filter out hidden accounts to match Graph View behavior, then convert to filtered format
    let visibleAccounts = results.accounts.filter(acc => !acc.hidden);
    // Also filter out asset accounts if requested
    if (excludeAssets) {
      visibleAccounts = visibleAccounts.filter(acc => !acc.id.startsWith('asset:'));
    }
    const filteredAccounts: FilteredAccount[] = visibleAccounts.map(
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

    // Always compute with perAccount so we can cache the full result
    const detResult = calculateYearlyMinBalances(filteredAccounts, true);

    // Merge asset values into deterministic results (same pattern as MC worker)
    const assetManager = getLastAssetManager();
    if (assetManager && !excludeAssets) {
      const yearlySnapshots = assetManager.getYearlySnapshots();
      for (const [year, assetValues] of yearlySnapshots) {
        // Add to perAccount
        if (detResult.perAccount) {
          if (!detResult.perAccount[year]) {
            detResult.perAccount[year] = {};
          }
          for (const [assetId, value] of assetValues) {
            detResult.perAccount[year][`asset:${assetId}`] = value;
          }
        }
        // Add to combined
        if (detResult.combined[year] !== undefined) {
          for (const [_, value] of assetValues) {
            detResult.combined[year] += value;
          }
        }
      }
    }

    // Cache the full result (always with perAccount)
    detCache.set(detCacheKey, detResult);

    // Return filtered based on caller's needs
    return {
      combined: detResult.combined,
      perAccount: separateAccounts ? detResult.perAccount : undefined,
    };
  } catch (error) {
    console.error('Failed to run deterministic calculation:', error);
    return null;
  }
}

/**
 * Loads metadata (including seed) from the results file
 */
function loadResultsMetadata(simulationId: string): { seed?: number; accountNames?: Array<{ id: string; name: string }> } {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  try {
    const resultsData = readFileSync(resultsPath, 'utf8');
    const fileData = JSON.parse(resultsData);
    return {
      seed: fileData.metadata?.seed,
      accountNames: fileData.metadata?.accountNames,
    };
  } catch {
    return {};
  }
}

/**
 * Computes Monte Carlo percentile graph data on-demand from raw results.
 * Supports per-account computation via optional accountId parameter.
 *
 * @param simulationId - ID of the completed simulation
 * @param accountId - Optional account ID; when provided, computes percentiles for that account only
 * @param survivingOnly - #14: If true, only include simulations where at least one person survives each year
 * @param excludeAssets - If true, filter out asset accounts from the calculations
 * @returns Graph data formatted for Chart.js consumption with both nominal and real values
 */
export async function computePercentileGraph(
  simulationId: string,
  accountId?: string,
  survivingOnly: boolean = false,
  excludeAssets: boolean = false,
): Promise<PercentileGraphData> {
  const PERCENTILES = [0, 5, 25, 40, 50, 60, 75, 95, 100];

  // Determine if we need per-account data
  const needsPerAccount = !!accountId || excludeAssets;

  // Process all simulations to get yearly data
  let simulationData = processAllSimulations(simulationId, needsPerAccount);

  if (simulationData.length === 0) {
    throw new Error('No simulation data found');
  }

  // Filter out asset accounts if requested
  if (excludeAssets) {
    simulationData = simulationData.map((sim) => {
      const filteredBalances = sim.yearlyAccountBalances ? filterOutAssets(sim.yearlyAccountBalances) : undefined;

      // Recalculate combined yearly min balances without assets
      const newCombined: YearlyMinBalances = {};
      if (filteredBalances) {
        for (const [yearStr, accounts] of Object.entries(filteredBalances)) {
          const year = parseInt(yearStr);
          newCombined[year] = Object.values(accounts).reduce((sum, val) => sum + val, 0);
        }
      }

      return {
        ...sim,
        yearlyMinBalances: newCombined,
        yearlyAccountBalances: filteredBalances,
      };
    });
  }

  // #14: Filter to surviving simulations if requested
  const totalSimsBeforeFilter = simulationData.length;
  if (survivingOnly) {
    // Collect all years first to know which ones to check
    const allYearsTemp = new Set<number>();
    simulationData.forEach((sim) => {
      Object.keys(sim.yearlyMinBalances).forEach((year) => {
        allYearsTemp.add(parseInt(year));
      });
    });
    const yearsToCheck = Array.from(allYearsTemp).sort();

    // Filter: keep only simulations where someone is alive in ALL years
    simulationData = simulationData.filter((sim) => {
      for (const year of yearsToCheck) {
        if (!hasAnyoneSurvivingInYear(sim.deathDates, year)) {
          return false; // All dead in this year, exclude this sim
        }
      }
      return true; // Has survivors in all years
    });
  }

  // Load metadata for seed and account names
  const metadata = loadResultsMetadata(simulationId);

  // #9: Compute funded ratio and failure statistics
  const totalSims = simulationData.length;
  const failedSims = simulationData.filter(
    (s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined,
  ).length;
  const fundedRatio = ((totalSims - failedSims) / totalSims) * 100;

  const failureYears = simulationData
    .filter((s) => s.fundingFailureYear !== null && s.fundingFailureYear !== undefined)
    .map((s) => s.fundingFailureYear!);
  const medianFailureYear =
    failureYears.length > 0
      ? failureYears.sort((a, b) => a - b)[Math.floor(failureYears.length / 2)]
      : null;

  // Collect all unique years across all simulations
  const allYears = new Set<number>();
  simulationData.forEach((sim) => {
    Object.keys(sim.yearlyMinBalances).forEach((year) => {
      allYears.add(parseInt(year));
    });
  });

  // Run deterministic calculation
  const deterministicData = await runDeterministicCalculation(simulationId, needsPerAccount, excludeAssets);
  if (deterministicData) {
    // Add years from deterministic calculation
    Object.keys(deterministicData.combined).forEach((year) => {
      allYears.add(parseInt(year));
    });
  }

  const sortedYears = Array.from(allYears).sort();
  const labels = sortedYears.map((year) => year.toString());

  // Create datasets
  const datasets: PercentileDataset[] = [];

  // Helper to get values for a given year from all simulations
  const getValuesForYear = (year: number): number[] => {
    const yearValues: number[] = [];
    if (accountId) {
      // Per-account mode
      simulationData.forEach((sim) => {
        if (sim.yearlyAccountBalances && sim.yearlyAccountBalances[year]) {
          const val = sim.yearlyAccountBalances[year][accountId];
          if (val !== undefined) {
            yearValues.push(val);
          }
        }
      });
    } else {
      // Combined mode
      simulationData.forEach((sim) => {
        const val = sim.yearlyMinBalances[year];
        if (val !== undefined) {
          yearValues.push(val);
        }
      });
    }
    return yearValues;
  };

  // Look up account name if per-account
  let accountName: string | undefined;
  if (accountId && metadata.accountNames) {
    const found = metadata.accountNames.find(a => a.id === accountId);
    if (found) {
      accountName = found.name;
    }
  }

  // Build percentile datasets
  PERCENTILES.forEach((percentile) => {
    const data: number[] = [];
    const realValues: number[] = [];

    sortedYears.forEach((year) => {
      const yearValues = getValuesForYear(year);
      yearValues.sort((a, b) => a - b);
      const percentileValue = calculatePercentile(yearValues, percentile);
      data.push(percentileValue);

      // Calculate real (inflation-adjusted) value
      const medianInflation = getMedianCumulativeInflationForYear(simulationData, year);
      realValues.push(percentileValue / medianInflation);
    });

    const label = accountId && accountName
      ? `${accountName} - ${percentile}${getOrdinalSuffix(percentile)} Percentile`
      : `${percentile}${getOrdinalSuffix(percentile)} Percentile`;

    datasets.push({
      label,
      data,
      percentile,
      realValues,
      ...(accountId ? { accountId, accountName } : {}),
    });
  });

  // Add deterministic line
  if (deterministicData) {
    if (accountId) {
      // Per-account deterministic
      if (deterministicData.perAccount) {
        const detData = sortedYears.map((year) => deterministicData.perAccount![year]?.[accountId] ?? 0);
        const realValues = sortedYears.map((year) => {
          const nominalValue = deterministicData.perAccount![year]?.[accountId] ?? 0;
          const medianInflation = getMedianCumulativeInflationForYear(simulationData, year);
          return nominalValue / medianInflation;
        });

        datasets.push({
          label: accountName ? `${accountName} - Deterministic` : 'Deterministic',
          data: detData,
          isDeterministic: true,
          realValues,
          ...(accountId ? { accountId, accountName } : {}),
        });
      }
    } else {
      // Combined deterministic
      const detData = sortedYears.map((year) => deterministicData.combined[year] ?? 0);
      const realValues = sortedYears.map((year) => {
        const nominalValue = deterministicData.combined[year] ?? 0;
        const medianInflation = getMedianCumulativeInflationForYear(simulationData, year);
        return nominalValue / medianInflation;
      });

      datasets.push({
        label: 'Deterministic',
        data: detData,
        isDeterministic: true,
        realValues,
      });
    }
  }

  // Compute worstYear: year with lowest median across simulations
  let worstYear: { year: number; medianMinBalance: number; realMedianMinBalance: number } | undefined;
  {
    let lowestMedian = Infinity;
    for (const year of sortedYears) {
      const yearValues = getValuesForYear(year);
      yearValues.sort((a, b) => a - b);
      const median = calculatePercentile(yearValues, 50);
      if (median < lowestMedian) {
        lowestMedian = median;
        const medianInflation = getMedianCumulativeInflationForYear(simulationData, year);
        worstYear = { year, medianMinBalance: median, realMedianMinBalance: median / medianInflation };
      }
    }
  }

  // Compute finalYear stats for the last year
  let finalYear: { median: number; p5: number; p25: number; p75: number; p95: number; realMedian: number; realP5: number; realP25: number; realP75: number; realP95: number } | undefined;
  if (sortedYears.length > 0) {
    const lastYear = sortedYears[sortedYears.length - 1];
    const lastYearValues = getValuesForYear(lastYear);
    lastYearValues.sort((a, b) => a - b);
    const median = calculatePercentile(lastYearValues, 50);
    const p5 = calculatePercentile(lastYearValues, 5);
    const p25 = calculatePercentile(lastYearValues, 25);
    const p75 = calculatePercentile(lastYearValues, 75);
    const p95 = calculatePercentile(lastYearValues, 95);
    const finalInflation = getMedianCumulativeInflationForYear(simulationData, lastYear);
    finalYear = {
      median,
      p5,
      p25,
      p75,
      p95,
      realMedian: median / finalInflation,
      realP5: p5 / finalInflation,
      realP25: p25 / finalInflation,
      realP75: p75 / finalInflation,
      realP95: p95 / finalInflation,
    };
  }

  // #14: Build deathDates array for client-side filtering
  const deathDatesData = simulationData.map((sim) => ({
    simulationNumber: sim.simulationNumber,
    deathDates: sim.deathDates || {},
  }));

  return {
    type: 'percentile',
    labels,
    datasets,
    fundedRatio,
    failedSimulations: failedSims,
    totalSimulations: totalSims,
    medianFailureYear,
    worstYear,
    finalYear,
    seed: metadata.seed,
    accountNames: metadata.accountNames,
    deathDates: deathDatesData,
    survivingOnlyApplied: survivingOnly,
  };
}

/**
 * Public wrapper for deterministic calculation, used by worstCases.ts.
 * Returns cached or freshly computed yearly min balances (combined + per-account).
 */
export async function runDeterministicForWorstCases(
  simulationId: string,
  separateAccounts: boolean = false,
): Promise<{ combined: YearlyMinBalances; perAccount?: YearlyAccountBalances } | null> {
  return runDeterministicCalculation(simulationId, separateAccounts);
}

/**
 * @deprecated Use computePercentileGraph instead. Kept for backward compatibility.
 */
export async function generateMonteCarloStatisticsGraph(
  simulationId: string,
  options: MonteCarloGraphOptions = {},
): Promise<PercentileGraphData> {
  // Delegate to the new on-demand function (combined mode only)
  return computePercentileGraph(simulationId);
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
