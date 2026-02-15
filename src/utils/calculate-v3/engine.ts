import { AccountsAndTransfers } from '../../data/account/types';
import { CalculationConfig, CalculationOptions, MonteCarloConfig } from './types';
import { CacheManager, initializeCache } from './cache';
import { Timeline } from './timeline';
import { BalanceTracker } from './balance-tracker';
import { SegmentProcessor } from './segment-processor';
import { Calculator } from './calculator';
import { minDate } from '../io/minDate';
import { PushPullHandler } from './push-pull-handler';
import { AccountManager } from './account-manager';
import { TaxManager } from './tax-manager';
import { RetirementManager } from './retirement-manager';
import { HealthcareManager } from './healthcare-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import { loadHealthcareConfigs } from '../io/healthcareConfigs';
import { loadSpendingTrackerCategories } from '../io/spendingTracker';
import { MonteCarloHandler } from './monte-carlo-handler';

export class Engine {
  private config: CalculationConfig;
  private cache: CacheManager;
  private timeline: Timeline;
  private balanceTracker: BalanceTracker;
  private segmentProcessor: SegmentProcessor;
  private calculator: Calculator;
  private pushPullHandler: PushPullHandler;
  private accountManager: AccountManager;
  private taxManager: TaxManager;
  private retirementManager: RetirementManager;
  private healthcareManager: HealthcareManager;
  private calculationBegin: number;
  private monteCarloConfig: MonteCarloConfig | null = null;

  constructor(simulation: string, config: Partial<CalculationConfig> = {}, monteCarlo: boolean = false) {
    this.config = this.mergeConfig(config);
    this.cache = initializeCache(this.config, simulation, monteCarlo);
  }

  async calculate(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    timeline?: Timeline,
  ): Promise<AccountsAndTransfers> {
    // Start timing
    this.calculationBegin = Date.now();

    // Try to retrieve from cache (will return null if monteCarlo is true)
    if (!options.forceRecalculation && !options.monteCarlo) {
      const cachedResult = await this.getCachedResult(options);
      if (cachedResult) {
        return cachedResult;
      }
    }

    // Initialize all components
    await this.initializeCalculation(accountsAndTransfers, options, timeline);

    // Perform the calculation
    const results = await this.performCalculations(accountsAndTransfers, options);

    // Format the results
    if (options.enableLogging) {
      console.log('Formatting results...', Date.now() - this.calculationBegin, 'ms');
    }
    const formattedResults = this.formatResults(results);

    // Store the results in cache (will skip if monteCarlo is true)
    if (!options.monteCarlo) {
      if (options.enableLogging) {
        console.log('Caching results...', Date.now() - this.calculationBegin, 'ms');
      }
      await this.cacheResult(formattedResults, options);
    }

    if (options.enableLogging) {
      console.log('Calculation completed in', Date.now() - this.calculationBegin, 'ms');
    }
    return formattedResults;
  }

  private mergeConfig(config: Partial<CalculationConfig>): CalculationConfig {
    const defaultConfig: CalculationConfig = {
      snapshotInterval: 'monthly',
      useDiskCache: false,
      diskCacheDir: './cache',
    };
    return {
      ...defaultConfig,
      ...config,
    };
  }

  private async getCachedResult(options: CalculationOptions): Promise<AccountsAndTransfers | null> {
    return await this.cache.getCalculationResult(options.startDate, options.endDate);
  }

  private async cacheResult(result: AccountsAndTransfers, options: CalculationOptions): Promise<void> {
    await this.cache.setCalculationResult(options.startDate, options.endDate, result);
  }

  private async initializeCalculation(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    timeline?: Timeline,
  ): Promise<void> {
    // Get the actual start date of the accounts and transfers
    const actualStartDate = minDate(accountsAndTransfers);

    // Create timeline - always start from earliest data to get correct balances
    // but we'll filter the final output by date range
    if (options.enableLogging) {
      console.log('Creating timeline...', Date.now() - this.calculationBegin, 'ms');
    }

    // Initialize Monte Carlo handler for Monte Carlo mode only
    if (options.enableLogging) {
      console.log('Initializing Monte Carlo handler...', Date.now() - this.calculationBegin, 'ms');
    }
    if (options.monteCarlo) {
      const handler = await MonteCarloHandler.getInstance(actualStartDate, options.endDate);

      this.monteCarloConfig = {
        enabled: options.monteCarlo,
        handler,
        simulationNumber: options.simulationNumber,
        totalSimulations: options.totalSimulations,
      };
    }

    const spendingTrackerCategories = loadSpendingTrackerCategories();

    if (!timeline) {
      this.timeline = await Timeline.fromAccountsAndTransfers(
        accountsAndTransfers,
        actualStartDate,
        options.endDate,
        this.calculationBegin,
        options.enableLogging,
        this.monteCarloConfig,
        options,
        spendingTrackerCategories,
      );
    } else {
      this.timeline = timeline.clone(actualStartDate, options.endDate, this.monteCarloConfig);
    }
    if (options.monteCarlo) {
      this.timeline.applyMonteCarlo();
    }
    this.accountManager = this.timeline.getAccountManager();

    // Initialize tax manager
    if (options.enableLogging) {
      console.log('Initializing tax manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.taxManager = new TaxManager();

    // Initialize retirement manager
    if (options.enableLogging) {
      console.log('Initializing retirement manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.retirementManager = new RetirementManager(
      this.accountManager.getSocialSecurities(),
      this.accountManager.getPensions(),
    );

    // Initialize healthcare manager
    if (options.enableLogging) {
      console.log('Initializing healthcare manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.healthcareManager = new HealthcareManager(await loadHealthcareConfigs());

    // Initialize spending tracker manager
    if (options.enableLogging) {
      console.log('Initializing spending tracker manager...', Date.now() - this.calculationBegin, 'ms');
    }
    const spendingTrackerManager = new SpendingTrackerManager(
      spendingTrackerCategories,
      options.simulation,
      actualStartDate,
    );

    // Initialize balance tracker - use actual start date for processing all historical data
    if (options.enableLogging) {
      console.log('Initializing balance tracker...', Date.now() - this.calculationBegin, 'ms');
    }
    this.balanceTracker = new BalanceTracker(accountsAndTransfers.accounts, this.cache, actualStartDate);

    // Initialize calculator
    if (options.enableLogging) {
      console.log('Initializing calculator...', Date.now() - this.calculationBegin, 'ms');
    }
    this.calculator = new Calculator(
      this.balanceTracker,
      this.taxManager,
      this.retirementManager,
      this.healthcareManager,
      this.accountManager,
      options.simulation,
      spendingTrackerManager,
    );

    // Initialize push-pull handler
    if (options.enableLogging) {
      console.log('Initializing push-pull handler...', Date.now() - this.calculationBegin, 'ms');
    }
    this.pushPullHandler = new PushPullHandler(this.accountManager, this.balanceTracker);

    // Initialize segment processor
    if (options.enableLogging) {
      console.log('Initializing segment processor...', Date.now() - this.calculationBegin, 'ms');
    }
    this.segmentProcessor = new SegmentProcessor(
      this.cache,
      this.balanceTracker,
      this.calculator,
      this.pushPullHandler,
      this.retirementManager,
      this.taxManager,
      this.accountManager,
      this.healthcareManager,
      spendingTrackerManager,
    );
  }

  private async performCalculations(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
  ): Promise<AccountsAndTransfers> {
    if (!this.timeline || !this.balanceTracker || !this.segmentProcessor || !this.calculator) {
      throw new Error('Calculation components not initialized');
    }
    if (options.enableLogging) {
      console.log('Performing calculations...', Date.now() - this.calculationBegin, 'ms');
    }

    const segments = this.timeline.getSegments();

    // Initialize accounts with starting balances
    await this.balanceTracker.initializeBalances(accountsAndTransfers, options.forceRecalculation);

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
            console.error('Error rounding activity amount:', activity.amount);
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
  timeline?: Timeline,
): Promise<AccountsAndTransfers> {
  const engine = new Engine(simulation, config, monteCarlo);

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

  const result = await engine.calculate(accountsAndTransfers, options, timeline);
  return result;
}
