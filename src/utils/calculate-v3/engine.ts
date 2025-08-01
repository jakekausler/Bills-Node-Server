import { AccountsAndTransfers } from '../../data/account/types';
import { CalculationConfig, CalculationOptions } from './types';
import { CacheManager, initializeCache, createCalculationKey } from './cache';
import { err } from '../calculate-v2/logger';
import { Timeline } from './timeline';
import { BalanceTracker } from './balance-tracker';
import { SegmentProcessor } from './segment-processor';
import { Calculator } from './calculator';
import { minDate } from '../io/minDate';
import { PushPullHandler } from './push-pull-handler';
import { AccountManager } from './account-manager';

export class Engine {
  private config: CalculationConfig;
  private cache: CacheManager;
  private timeline: Timeline;
  private balanceTracker: BalanceTracker;
  private segmentProcessor: SegmentProcessor;
  private calculator: Calculator;
  private pushPullHandler: PushPullHandler;
  private accountManager: AccountManager;

  constructor(config: Partial<CalculationConfig> = {}) {
    this.config = this.mergeConfig(config);
    this.cache = initializeCache(this.config);
  }

  async calculate(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
  ): Promise<AccountsAndTransfers> {
    // Try to retrieve from cache
    if (!options.forceRecalculation) {
      const cachedResult = await this.getCachedResult(options);
      if (cachedResult) {
        return cachedResult;
      }
    }

    // Initialize all components
    this.initializeCalculation(accountsAndTransfers, options);

    // Perform the calculation
    const results = await this.performCalculations(accountsAndTransfers, options);

    // Format the results
    const formattedResults = this.formatResults(results);

    // Store the results in cache
    await this.cacheResult(formattedResults, options);

    return formattedResults;
  }

  private mergeConfig(config: Partial<CalculationConfig>): CalculationConfig {
    const defaultConfig: CalculationConfig = {
      snapshotInterval: 'monthly',
      useDiskCache: true,
      diskCacheDir: './cache/calculate-v2',
    };
    return {
      ...defaultConfig,
      ...config,
    };
  }

  private async getCachedResult(options: CalculationOptions): Promise<AccountsAndTransfers | null> {
    const cacheKey = createCalculationKey(options.startDate, options.endDate, options.simulation, options.monteCarlo);

    return await this.cache.get<AccountsAndTransfers>(cacheKey);
  }

  private async cacheResult(result: AccountsAndTransfers, options: CalculationOptions): Promise<void> {
    const cacheKey = createCalculationKey(options.startDate, options.endDate, options.simulation, options.monteCarlo);

    await this.cache.set(cacheKey, result);
  }

  private initializeCalculation(accountsAndTransfers: AccountsAndTransfers, options: CalculationOptions): void {
    // Initialize account manager
    this.accountManager = new AccountManager(accountsAndTransfers.accounts);

    // Create timeline - always start from earliest data to get correct balances
    // but we'll filter the final output by date range
    const actualStartDate = minDate(accountsAndTransfers);
    this.timeline = Timeline.fromAccountsAndTransfers(
      this.accountManager,
      accountsAndTransfers,
      actualStartDate,
      options.endDate,
    );

    // Initialize balance tracker - use actual start date for processing all historical data
    this.balanceTracker = new BalanceTracker(accountsAndTransfers.accounts, this.cache, actualStartDate);

    // Initialize calculator
    this.calculator = new Calculator(this.balanceTracker, options.simulation);

    // Initialize push-pull handler
    this.pushPullHandler = new PushPullHandler(this.accountManager, this.balanceTracker);

    // Initialize segment processor
    this.segmentProcessor = new SegmentProcessor(
      this.cache,
      this.balanceTracker,
      this.calculator,
      this.pushPullHandler,
    );
  }

  private async performCalculations(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
  ): Promise<AccountsAndTransfers> {
    if (!this.timeline || !this.balanceTracker || !this.segmentProcessor || !this.calculator) {
      throw new Error('Calculation components not initialized');
    }

    const segments = this.timeline.getSegments();

    // Initialize accounts with starting balances
    this.balanceTracker.initializeBalances(accountsAndTransfers, options.forceRecalculation);

    // Process segments in order
    for (const segment of segments) {
      await this.segmentProcessor.processSegment(segment, options);
    }

    // Clamp activities to the specified date range
    const updatedAccounts = this.balanceTracker.getAccountsWithFilteredDates(options.startDate, options.endDate);

    return {
      accounts: updatedAccounts,
      transfers: accountsAndTransfers.transfers,
    };
  }

  private formatResults(results: AccountsAndTransfers): AccountsAndTransfers {
    // Round amounts and balances to 2 decimal places
    // We only round amounts and balances in the consolidatedActivity
    results.accounts.forEach((account) => {
      // The accounts from getUpdatedAccounts have consolidatedActivity, not activity
      if (account.consolidatedActivity) {
        account.consolidatedActivity.forEach((activity) => {
          try {
            activity.amount = Math.round(Number(activity.amount) * 100) / 100; // Round to 2 decimal places
          } catch {
            err('Error rounding activity amount:', activity.amount);
          }
          activity.balance = Math.round(activity.balance * 100) / 100; // Round to 2 decimal places
        });
      }
    });
    return results;
  }
}

/**
 * Convenience function for performing calculations
 */
export async function calculateAllActivity(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date | null,
  endDate: Date,
  simulation: string = 'Default',
  monteCarlo: boolean = false,
  simulationNumber: number = 1,
  totalSimulations: number = 1,
  forceRecalculation: boolean = false,
  enableLogging: boolean = false,
  config: Partial<CalculationConfig> = {},
): Promise<AccountsAndTransfers> {
  const engine = new Engine(config);

  const options: CalculationOptions = {
    startDate,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    totalSimulations,
    forceRecalculation,
    enableLogging,
    config,
  };

  const result = await engine.calculate(accountsAndTransfers, options);
  return result;
}
