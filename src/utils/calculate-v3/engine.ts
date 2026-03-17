import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AccountsAndTransfers } from '../../data/account/types';
import { CalculationConfig, CalculationOptions, FilingStatus, MonteCarloConfig } from './types';
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
import { MedicareManager } from './medicare-manager';
import { AcaManager } from './aca-manager';
import { LTCManager } from './ltc-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import { loadHealthcareConfigs } from '../io/healthcareConfigs';
import { loadSpendingTrackerCategories } from '../io/spendingTracker';
import { loadVariable } from '../simulation/variable';
import { MonteCarloHandler } from './monte-carlo-handler';
import { computePeriodBoundaries } from './period-utils';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

// Global reference to the last engine instance (for accessing pull failures after calculation)
let lastEngine: Engine | null = null;

export class Engine {
  private config: CalculationConfig;
  private cache: CacheManager;
  private simulation: string;
  private timeline: Timeline;
  private balanceTracker: BalanceTracker;
  private segmentProcessor: SegmentProcessor;
  private calculator: Calculator;
  private pushPullHandler: PushPullHandler;
  private accountManager: AccountManager;
  private taxManager: TaxManager;
  private retirementManager: RetirementManager;
  private healthcareManager: HealthcareManager;
  private medicareManager: MedicareManager;
  private acaManager: AcaManager;
  private ltcManager: LTCManager;
  private calculationBegin: number;
  private monteCarloConfig: MonteCarloConfig | null = null;

  constructor(simulation: string, config: Partial<CalculationConfig> = {}, monteCarlo: boolean = false) {
    this.simulation = simulation;
    this.config = this.mergeConfig(config);
    this.cache = initializeCache(this.config, simulation, monteCarlo);
  }

  async calculate(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    timeline?: Timeline,
  ): Promise<AccountsAndTransfers> {
    // Set this as the last engine for access to pull failures
    lastEngine = this;

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
      const handler = await MonteCarloHandler.getInstance(actualStartDate, options.endDate, options.seed);

      const mappingsPath = join(process.cwd(), 'data', 'monteCarloMappings.json');
      const variableMappings = existsSync(mappingsPath)
        ? JSON.parse(readFileSync(mappingsPath, 'utf-8'))
        : {};

      this.monteCarloConfig = {
        enabled: options.monteCarlo,
        handler,
        simulationNumber: options.simulationNumber,
        totalSimulations: options.totalSimulations,
        variableMappings,
      };
    }

    // Load tax configuration (filing status and withdrawal strategy)
    const taxConfigPath = join(process.cwd(), 'data', 'taxConfig.json');
    const taxConfig = existsSync(taxConfigPath)
      ? JSON.parse(readFileSync(taxConfigPath, 'utf-8'))
      : { filingStatus: 'mfj', withdrawalStrategy: 'manual' };

    if (!options.filingStatus) {
      options.filingStatus = taxConfig.filingStatus || 'mfj';
    }

    if (!options.withdrawalStrategy) {
      options.withdrawalStrategy = taxConfig.withdrawalStrategy || 'manual';
    }

    // Set bracket inflation rate: use MC inflation if available, else default to 0.03
    if (!options.bracketInflationRate) {
      // If MC is enabled, try to extract inflation from MC config
      if (this.monteCarloConfig && this.monteCarloConfig.handler) {
        // Default to 0.03 for now; can be enhanced to use actual MC inflation sample
        options.bracketInflationRate = 0.03;
      } else {
        options.bracketInflationRate = 0.03;
      }
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
    let healthcareConfigs = await loadHealthcareConfigs();

    // Task 7: Add virtual ACA healthcare plan if needed
    // Check if we need to generate a virtual ACA plan for the retirement-to-65 gap
    try {
      const retireDateResult = loadVariable('RETIRE_DATE', this.simulation);
      const retireDate = retireDateResult instanceof Date ? retireDateResult : null;

      if (retireDate) {
        // Get both persons' birth dates from social security config
        const socialSecurities = this.accountManager.getSocialSecurities();
        const birthDates: Date[] = [];

        for (const ss of socialSecurities) {
          try {
            const birthDateResult = loadVariable(ss.birthDateVariable, this.simulation);
            if (birthDateResult instanceof Date) {
              birthDates.push(birthDateResult);
            }
          } catch (e) {
            // Skip if birth date not found
          }
        }

        if (birthDates.length >= 2) {
          // Calculate age 65 dates for both persons
          const age65Date1 = dayjs.utc(birthDates[0]).add(65, 'year').toDate();
          const age65Date2 = dayjs.utc(birthDates[1]).add(65, 'year').toDate();
          const laterAge65Date = age65Date1 > age65Date2 ? age65Date1 : age65Date2;

          // Check if no plan covers the ACA gap (between retire date and age 65)
          const hasCoverageDuringGap = healthcareConfigs.some(config => {
            const configStartDate = new Date(config.startDate);
            const configEndDate = config.endDate ? new Date(config.endDate) : null;
            return (
              configStartDate <= retireDate &&
              (!configEndDate || configEndDate >= laterAge65Date)
            );
          });

          if (!hasCoverageDuringGap && retireDate < laterAge65Date) {
            // Initialize ACA manager temporarily to get deductible/OOP values
            this.acaManager = new AcaManager();
            const retireYear = retireDate.getUTCFullYear();
            const acaDeductible = this.acaManager.getAcaDeductible(retireYear);
            const acaOOPMax = this.acaManager.getAcaOOPMax(retireYear);

            // Create virtual ACA Silver plan
            const virtualAcaPlan: HealthcareConfig = {
              id: 'virtual-aca-silver-' + Math.random().toString(36).substring(7),
              name: 'ACA Silver Plan (Virtual)',
              coveredPersons: ['Jake', 'Kendall'],
              startDate: retireDate.toISOString().split('T')[0] as any,
              startDateIsVariable: false,
              endDate: laterAge65Date.toISOString().split('T')[0] as any,
              endDateIsVariable: false,
              individualDeductible: acaDeductible.individual,
              individualOutOfPocketMax: acaOOPMax.individual,
              familyDeductible: acaDeductible.family,
              familyOutOfPocketMax: acaOOPMax.family,
              hsaAccountId: null,
              hsaReimbursementEnabled: false,
              resetMonth: 0,
              resetDay: 1,
              deductibleInflationRate: 0.05, // 5% healthcare inflation
            };

            healthcareConfigs = [...healthcareConfigs, virtualAcaPlan];
          }
        }
      }
    } catch (e) {
      // If variable loading fails, proceed with existing configs
    }

    this.healthcareManager = new HealthcareManager(healthcareConfigs, this.simulation);

    // Initialize Medicare manager
    if (options.enableLogging) {
      console.log('Initializing Medicare manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.medicareManager = new MedicareManager();

    // Initialize ACA manager
    if (options.enableLogging) {
      console.log('Initializing ACA manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.acaManager = new AcaManager();

    // Initialize LTC manager
    if (options.enableLogging) {
      console.log('Initializing LTC manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.ltcManager = new LTCManager();

    // Initialize spending tracker manager
    if (options.enableLogging) {
      console.log('Initializing spending tracker manager...', Date.now() - this.calculationBegin, 'ms');
    }
    const spendingTrackerManager = new SpendingTrackerManager(
      spendingTrackerCategories,
      options.simulation,
      actualStartDate,
    );

    // Pre-set lastProcessedPeriodEnd so that recordSegmentActivities filters out
    // activities from before the first active (non-virtual) period.
    // The first active period is the current period (computed from today's date).
    for (const category of spendingTrackerCategories) {
      const today = dayjs.utc().startOf('day');
      const todayBoundaries = computePeriodBoundaries(
        category.interval,
        category.intervalStart,
        today.subtract(1, 'year').toDate(),
        today.add(1, 'day').toDate(),
      );
      const currentPeriod = todayBoundaries.find(
        b => !dayjs.utc(b.periodStart).isAfter(today, 'day') && !dayjs.utc(b.periodEnd).isBefore(today, 'day'),
      );
      if (currentPeriod) {
        const filterDate = dayjs.utc(currentPeriod.periodStart).subtract(1, 'day').toDate();
        spendingTrackerManager.markPeriodProcessed(category.id, filterDate);
      }
    }

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
      this.medicareManager,
      this.ltcManager,
      this.accountManager,
      options.simulation,
      spendingTrackerManager,
      this.acaManager,
      (options.filingStatus as FilingStatus) || 'mfj',
      options.bracketInflationRate || 0.03,
    );

    // Set Monte Carlo config if available
    if (this.monteCarloConfig) {
      this.calculator.setMonteCarloConfig(this.monteCarloConfig);
    }

    // Initialize push-pull handler
    if (options.enableLogging) {
      console.log('Initializing push-pull handler...', Date.now() - this.calculationBegin, 'ms');
    }
    this.pushPullHandler = new PushPullHandler(this.accountManager, this.balanceTracker, options.withdrawalStrategy);

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
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
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

  /**
   * Get pull failures from the push/pull handler
   */
  getPullFailures() {
    return this.pushPullHandler ? this.pushPullHandler.getPullFailures() : [];
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
  seed?: number,
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
    seed,
  };

  const result = await engine.calculate(accountsAndTransfers, options, timeline);
  return result;
}

/**
 * Get pull failures from the last calculation
 */
export function getLastPullFailures() {
  return lastEngine ? lastEngine.getPullFailures() : [];
}
