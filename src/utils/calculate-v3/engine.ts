import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { PortfolioMakeupOverTime } from './types';
import { Account } from '../../data/account/account';
import { AccountsAndTransfers } from '../../data/account/types';
import { CalculationConfig, CalculationOptions, FilingStatus, MCRateGetter, MonteCarloConfig, MonteCarloSampleType } from './types';
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
import { MortalityManager } from './mortality-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import { loadAllHealthcareConfigs } from '../io/virtualHealthcarePlans';
import { loadSpendingTrackerCategories } from '../io/spendingTracker';
import { MonteCarloHandler } from './monte-carlo-handler';
import { computePeriodBoundaries } from './period-utils';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { DebugLogger } from './debug-logger';
import { FlowAggregator } from './flow-aggregator';
import { setTaxScenario } from './bracket-calculator';
import { load } from '../io/io';
import type { TaxScenario } from './tax-profile-types';
import { loadVariable } from '../simulation/variable';

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
  private mortalityManager: MortalityManager;
  private calculationBegin: number;
  private monteCarloConfig: MonteCarloConfig | null = null;
  private debugLogger: DebugLogger | null;
  private simNumber: number = 0;
  private currentDate: string = '';
  private flowAggregator: FlowAggregator | null = null;

  constructor(simulation: string, config: Partial<CalculationConfig> = {}, monteCarlo: boolean = false, debugLogger?: DebugLogger | null) {
    this.simulation = simulation;
    this.config = this.mergeConfig(config);
    this.cache = initializeCache(this.config, simulation, monteCarlo);
    this.debugLogger = debugLogger ?? null;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'engine', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  async calculate(
    accountsAndTransfers: AccountsAndTransfers,
    options: CalculationOptions,
    timeline?: Timeline,
  ): Promise<AccountsAndTransfers> {
    // Set this as the last engine for access to pull failures
    lastEngine = this;

    // Thread simulation number for debug logging
    this.simNumber = options.simulationNumber ?? 0;

    // Start timing
    this.calculationBegin = Date.now();

    this.log('calculation-started', {
      simulation: options.simulation,
      startDate: options.startDate?.toISOString() ?? null,
      endDate: options.endDate.toISOString(),
      monteCarlo: options.monteCarlo,
      forceRecalculation: options.forceRecalculation,
    });

    // Try to retrieve from cache (will return null if monteCarlo is true)
    if (!options.forceRecalculation && !options.monteCarlo) {
      const cachedResult = await this.getCachedResult(options);
      if (cachedResult) {
        this.log('cache-check', { cacheHit: true });
        return cachedResult;
      }
    }
    this.log('cache-check', { cacheHit: false });

    try {
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

      this.log('calculation-completed', { durationMs: Date.now() - this.calculationBegin });

      return formattedResults;
    } finally {
      // Always flush debug logs, even if calculation threw an error
      if (this.debugLogger) {
        this.debugLogger.writeMeta({
          simulation: options.simulation,
          monteCarlo: options.monteCarlo,
          simulationNumber: options.simulationNumber,
          totalSimulations: options.totalSimulations,
          startDate: options.startDate?.toISOString() ?? null,
          endDate: options.endDate.toISOString(),
          durationMs: Date.now() - this.calculationBegin,
        });
        this.debugLogger.close();
      }
    }
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

    if (!options.taxAccountName && taxConfig.taxAccountName) {
      options.taxAccountName = taxConfig.taxAccountName;
    }

    this.log('tax-config-loaded', {
      filingStatus: options.filingStatus,
      withdrawalStrategy: options.withdrawalStrategy,
      taxAccountName: options.taxAccountName,
    });

    // Load tax scenario (bracket evolution policy)
    let taxScenario: TaxScenario = {
      name: 'currentPolicy',
      bracketEvolution: 'tcjaPermanent',
      customRates: null,
    };
    if (!options.taxScenario) {
      try {
        taxScenario = load<TaxScenario>('taxScenario.json');
      } catch {
        // Use default if file not found
        taxScenario = {
          name: 'currentPolicy',
          bracketEvolution: 'tcjaPermanent',
          customRates: null,
        };
      }
    } else {
      taxScenario = options.taxScenario;
    }
    setTaxScenario(taxScenario);
    this.log('tax-scenario-loaded', {
      name: taxScenario.name,
      bracketEvolution: taxScenario.bracketEvolution,
    });

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
    // Load portfolio glide path data
    const portfolioMakeupPath = join(process.cwd(), 'data', 'portfolioMakeupOverTime.json');
    let portfolioMakeup: PortfolioMakeupOverTime | null = null;
    if (existsSync(portfolioMakeupPath)) {
      portfolioMakeup = JSON.parse(readFileSync(portfolioMakeupPath, 'utf-8'));
      this.timeline.setPortfolioMakeup(portfolioMakeup);
    }

    if (options.monteCarlo) {
      this.timeline.applyMonteCarlo();
    } else if (portfolioMakeup) {
      // In deterministic mode, apply the portfolio glide path to blend
      // INVESTMENT_RATE interest events using per-asset-class return variables
      this.timeline.applyGlidePath();
    }
    this.accountManager = this.timeline.getAccountManager();

    this.log('timeline-created', { eventCount: this.timeline.getSegments().reduce((sum, s) => sum + s.events.length, 0) });

    // Initialize tax manager
    if (options.enableLogging) {
      console.log('Initializing tax manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.taxManager = new TaxManager(this.debugLogger, this.simNumber);

    // Initialize retirement manager
    if (options.enableLogging) {
      console.log('Initializing retirement manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.retirementManager = new RetirementManager(
      this.accountManager.getSocialSecurities(),
      this.accountManager.getPensions(),
      this.debugLogger,
      this.simNumber,
    );

    // Initialize healthcare manager
    if (options.enableLogging) {
      console.log('Initializing healthcare manager...', Date.now() - this.calculationBegin, 'ms');
    }
    const healthcareConfigs = loadAllHealthcareConfigs(this.simulation);

    // TODO (#13): MC sampling for deductible/OOP change ratios
    // Eventually sample deductible/OOP max using MC-sampled change ratios (acaOOPMax, medicareDeductible)
    // instead of fixed historical averages. This would make healthcare costs vary per simulation.

    this.healthcareManager = new HealthcareManager(healthcareConfigs, this.simulation, this.debugLogger, this.simNumber);

    // Initialize Medicare manager
    if (options.enableLogging) {
      console.log('Initializing Medicare manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.medicareManager = new MedicareManager(this.debugLogger, this.simNumber);

    // Initialize ACA manager
    if (options.enableLogging) {
      console.log('Initializing ACA manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.acaManager = new AcaManager(this.debugLogger, this.simNumber);

    // Initialize mortality manager
    if (options.enableLogging) {
      console.log('Initializing mortality manager...', Date.now() - this.calculationBegin, 'ms');
    }
    this.mortalityManager = new MortalityManager(this.debugLogger, this.simNumber);

    // Initialize spending tracker manager
    if (options.enableLogging) {
      console.log('Initializing spending tracker manager...', Date.now() - this.calculationBegin, 'ms');
    }
    const spendingTrackerManager = new SpendingTrackerManager(
      spendingTrackerCategories,
      options.simulation,
      actualStartDate,
      this.debugLogger,
      this.simNumber,
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

    // Create FlowAggregator for MC mode only (no overhead for deterministic)
    if (options.monteCarlo) {
      this.flowAggregator = new FlowAggregator();
    } else {
      this.flowAggregator = null;
    }

    // Initialize balance tracker - use actual start date for processing all historical data
    if (options.enableLogging) {
      console.log('Initializing balance tracker...', Date.now() - this.calculationBegin, 'ms');
    }
    this.balanceTracker = new BalanceTracker(accountsAndTransfers.accounts, this.cache, actualStartDate, this.debugLogger, this.simNumber);

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
      this.mortalityManager,
      this.accountManager,
      options.simulation,
      spendingTrackerManager,
      this.acaManager,
      (options.filingStatus as FilingStatus) || 'mfj',
      options.bracketInflationRate || 0.03,
      this.debugLogger,
      this.simNumber,
      this.flowAggregator,
    );

    // Set Monte Carlo config if available
    if (this.monteCarloConfig) {
      this.calculator.setMonteCarloConfig(this.monteCarloConfig);

      // Wire MC rate getter to managers that need per-year sampled rates
      const mcRateGetter: MCRateGetter = (type: MonteCarloSampleType, year: number): number | null => {
        if (!this.monteCarloConfig?.handler) return null;
        return this.monteCarloConfig.handler.getSample(type, new Date(Date.UTC(year, 0, 1)));
      };
      this.calculator.setMCRateGetter(mcRateGetter);
      this.acaManager.setMCRateGetter(mcRateGetter);
      this.mortalityManager.setMCRateGetter(mcRateGetter);
      this.medicareManager.setMCRateGetter(mcRateGetter);
      this.retirementManager.setMCRateGetter(mcRateGetter);
    }

    // Initialize push-pull handler
    if (options.enableLogging) {
      console.log('Initializing push-pull handler...', Date.now() - this.calculationBegin, 'ms');
    }
    this.pushPullHandler = new PushPullHandler(
      this.accountManager,
      this.balanceTracker,
      options.withdrawalStrategy,
      this.calculator.getRothConversionManager(),
      this.taxManager,
      this.debugLogger,
      this.simNumber,
      this.flowAggregator,
    );

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
      this.debugLogger,
      this.simNumber,
    );

    this.log('components-initialized');
  }

  /**
   * Determine whether an account is a "portfolio" account for flow aggregation.
   * Portfolio accounts: accounts with interest rates, usesRMD, or contribution limits.
   * Excluded: checking (performsPulls && !usesRMD), credit cards, loans.
   */
  private isPortfolioAccount(account: Account): boolean {
    // Exclude credit cards and loans
    if (account.type === 'Credit' || account.type === 'Loan') return false;
    // Exclude checking accounts (performsPulls but not retirement)
    if (account.performsPulls && !account.usesRMD) return false;
    // Include if has interest, uses RMD, or has contribution limits
    if (account.interests && account.interests.length > 0) return true;
    if (account.usesRMD) return true;
    if (account.contributionLimitType) return true;
    return false;
  }

  /**
   * Compute sum of portfolio account balances for the flow aggregator.
   */
  private getPortfolioBalance(): number {
    const allAccounts = this.accountManager.getAllAccounts();
    let total = 0;
    for (const account of allAccounts) {
      if (this.isPortfolioAccount(account)) {
        total += this.balanceTracker.getAccountBalance(account.id);
      }
    }
    return total;
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

    // Track year boundaries for flow aggregator balance recording
    // Note: if segments skip entire years (no events), those years will have no FlowSummary entry.
    // Downstream consumers should interpolate or handle missing years.
    let lastYear = segments.length > 0 ? segments[0].startDate.getUTCFullYear() : 0;
    if (this.flowAggregator && segments.length > 0) {
      this.flowAggregator.setStartingBalance(lastYear, this.getPortfolioBalance());
    }

    // Process segments in order
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      // Check for year boundary before processing segment
      const segmentYear = segment.startDate.getUTCFullYear();
      if (segmentYear > lastYear || (i === 0 && this.monteCarloConfig)) {
        if (this.flowAggregator && segmentYear > lastYear) {
          this.flowAggregator.setEndingBalance(lastYear, this.getPortfolioBalance());
          this.flowAggregator.setStartingBalance(segmentYear, this.getPortfolioBalance());
        }

        // Year-boundary hook for job loss evaluation (MC mode only)
        this.evaluateJobLossAtYearBoundary(segmentYear, accountsAndTransfers);

        // Year-boundary hook for under-65 mortality evaluation (MC mode only)
        this.evaluateAnnualMortalityAtYearBoundary(segmentYear);

        lastYear = segmentYear;
      }

      await this.segmentProcessor.processSegment(segment, options);
    }

    // Set ending balance for the final year
    if (this.flowAggregator && segments.length > 0) {
      this.flowAggregator.setEndingBalance(lastYear, this.getPortfolioBalance());
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
   * Evaluate job loss for all paychecks with jobLoss enabled at a year boundary.
   * Only runs in MC mode (when monteCarloConfig is set).
   */
  private evaluateJobLossAtYearBoundary(year: number, accountsAndTransfers: AccountsAndTransfers): void {
    if (!this.monteCarloConfig || !this.calculator) return;

    // Get the PRNG from the MC config
    if (!this.monteCarloConfig.handler) return;
    const prng = this.monteCarloConfig.handler.getPRNG();
    if (!prng) return;

    // Iterate through all accounts and bills to find paychecks with jobLoss enabled
    for (const account of accountsAndTransfers.accounts) {
      for (const bill of account.bills) {
        const profile = bill.paycheckProfile;
        if (!profile || !profile.jobLoss?.enabled) continue;

        // Get MC-sampled unemployment data for this year
        const yearDate = new Date(Date.UTC(year, 0, 1));
        const unemploymentRate = this.monteCarloConfig.handler.getSample(MonteCarloSampleType.UNEMPLOYMENT_RATE, yearDate) ?? 4.0;
        const unemploymentDuration = this.monteCarloConfig.handler.getSample(MonteCarloSampleType.UNEMPLOYMENT_DURATION, yearDate) ?? 20;

        // Evaluate job loss for this person at the year start
        this.calculator.getJobLossManager().evaluateYearStart(
          year,
          bill.name,
          bill.endDate,
          unemploymentRate,
          unemploymentDuration,
          profile.jobLoss.scaleFactor || 1.5,
          prng,
        );
      }
    }
  }

  /**
   * Evaluate under-65 annual mortality at year boundary.
   * Only runs in MC mode (when monteCarloConfig is set).
   */
  private evaluateAnnualMortalityAtYearBoundary(year: number): void {
    if (!this.monteCarloConfig || !this.calculator) return;
    const mortalityManager = this.calculator.getMortalityManager();
    if (!mortalityManager) return;

    // Get the PRNG from the MC config
    if (!this.monteCarloConfig.handler) return;
    const prng = this.monteCarloConfig.handler.getPRNG();
    if (!prng) return;

    // Get all tracked persons from mortality manager
    for (const person of mortalityManager.getAlivePeople()) {
      // Get person config to access birthDateVariable and gender
      const config = mortalityManager.getConfig(person);
      if (!config) continue;

      // Load birth date from the variable
      let birthDate: Date;
      try {
        birthDate = loadVariable(config.birthDateVariable, this.simulation) as Date;
      } catch {
        // If we can't load the birth date, skip this person
        continue;
      }

      // Calculate age at the year boundary
      const age = year - birthDate.getUTCFullYear();
      if (age >= 65) continue; // 65+ mortality is handled by stepMonth monthly checks

      // Evaluate annual mortality check
      const yearBoundaryDate = new Date(Date.UTC(year, 0, 1));
      mortalityManager.evaluateAnnualMortality(person, age, config.gender, yearBoundaryDate, prng);
    }
  }

  /**
   * Get pull failures from the push/pull handler
   */
  getPullFailures() {
    return this.pushPullHandler ? this.pushPullHandler.getPullFailures() : [];
  }

  /**
   * Get the FlowAggregator instance (for MC worker to extract data after calculation)
   */
  getFlowAggregator(): FlowAggregator | null {
    return this.flowAggregator;
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
  debugLogger?: DebugLogger | null,
): Promise<AccountsAndTransfers> {
  const engine = new Engine(simulation, config, monteCarlo, debugLogger);

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
    debugLogger: debugLogger ?? null,
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

/**
 * Get the FlowAggregator from the last calculation (for MC worker to extract flow data)
 */
export function getLastFlowAggregator(): FlowAggregator | null {
  return lastEngine ? lastEngine.getFlowAggregator() : null;
}
