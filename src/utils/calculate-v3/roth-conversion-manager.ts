import { readFileSync } from 'fs';
import { join } from 'path';
import { TaxManager } from './tax-manager';
import { BalanceTracker } from './balance-tracker';
import { AccountManager } from './account-manager';
import { FilingStatus, getBracketDataForYear } from './bracket-calculator';
import { loadDateOrVariable } from '../simulation/loadVariableValue';
import dayjs from 'dayjs';

interface ConversionLot {
  year: number;
  amount: number;
  /** The year when this conversion becomes penalty-free (5 years after the conversion) */
  penaltyFreeYear: number;
}

interface RothConversionConfig {
  enabled: boolean;
  sourceAccount: string;
  destinationAccount: string;
  startDateVariable: string;
  endDateVariable: string;
  strategy: 'fillBracket' | 'percentOfBracket';
  targetBracketRate: number;
  priority: 'largerFirst' | 'smallerFirst';
}

export class RothConversionManager {
  private configs: RothConversionConfig[] = [];
  private conversionLots: Map<string, ConversionLot[]> = new Map();
  private accountManager: AccountManager;
  private balanceTracker: BalanceTracker | null = null;

  constructor(accountManager: AccountManager) {
    this.accountManager = accountManager;
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      const configPath = join(process.cwd(), 'data', 'rothConversionConfig.json');
      const configData = readFileSync(configPath, 'utf-8');
      this.configs = JSON.parse(configData) as RothConversionConfig[];
    } catch (error) {
      // Config file not found or invalid - no Roth conversions
      this.configs = [];
    }
  }

  /**
   * Process Roth conversions for a given year.
   * Runs after all other events for the year to determine remaining bracket space.
   *
   * TODO #20: Handle conversion lots tracking and 5-year rule integration
   */
  public processConversions(
    year: number,
    taxManager: TaxManager,
    balanceTracker: BalanceTracker,
    filingStatus: FilingStatus = 'mfj',
    inflationRate: number = 0.03,
    simulation: string = 'default',
  ): void {
    if (!this.configs || this.configs.length === 0) {
      return;
    }

    // Store balance tracker for use in calculateLiquidAssets
    this.balanceTracker = balanceTracker;

    // Filter and sort enabled configs by priority
    const enabledConfigs = this.configs.filter(c => c.enabled);
    const sortedConfigs = this.sortConfigsByPriority(enabledConfigs, balanceTracker);

    for (const config of sortedConfigs) {
      // Load start/end dates from variables
      const startDateResult = loadDateOrVariable(null, true, config.startDateVariable, simulation);
      const endDateResult = loadDateOrVariable(null, true, config.endDateVariable, simulation);

      const startDate = startDateResult.date ? startDateResult.date.getUTCFullYear() : null;
      const endDate = endDateResult.date ? endDateResult.date.getUTCFullYear() : null;

      // Skip if current year is outside the conversion window
      if (startDate !== null && year < startDate) continue;
      if (endDate !== null && year > endDate) continue;

      // Get source and destination accounts
      const sourceAccount = this.accountManager.getAccountByName(config.sourceAccount);
      const destAccount = this.accountManager.getAccountByName(config.destinationAccount);

      if (!sourceAccount || !destAccount) {
        continue;
      }

      // Get current year's taxable income from tax manager
      const taxableOccurrences = taxManager.getAllOccurrencesForYear(year);
      let ordinaryIncome = 0;
      for (const occ of taxableOccurrences) {
        if (occ.incomeType === 'ordinary' || occ.incomeType === 'retirement' || occ.incomeType === 'interest') {
          ordinaryIncome += occ.amount;
        }
      }

      // Get bracket data for this year
      const bracketData = getBracketDataForYear(year, filingStatus, inflationRate);
      const brackets = bracketData.brackets[filingStatus];
      const standardDeduction = bracketData.standardDeduction[filingStatus];

      // Find the target bracket threshold
      const targetBracketInfo = this.findBracketForRate(brackets, config.targetBracketRate);
      if (!targetBracketInfo) {
        continue;
      }

      // Calculate remaining space to target bracket
      const taxableIncome = Math.max(0, ordinaryIncome - standardDeduction);
      let remainingSpace = Math.max(0, targetBracketInfo.thresholdEnd - taxableIncome);

      if (remainingSpace <= 0) {
        // Already at or above target bracket
        continue;
      }

      // Check source account has funds
      const sourceBalance = balanceTracker.getAccountBalance(sourceAccount.id);
      if (sourceBalance <= 0) {
        continue;
      }

      // Check liquid assets can cover estimated tax on conversion
      const conversionAmount = Math.min(sourceBalance, remainingSpace);
      const estimatedConversionTax = conversionAmount * config.targetBracketRate;

      // Liquid assets = accounts with performsPulls === true && usesRMD === false && not destination
      const liquidAvailable = this.calculateLiquidAssets(destAccount.id, balanceTracker);
      if (liquidAvailable < estimatedConversionTax) {
        // Can't cover tax without depleting liquid reserves
        continue;
      }

      // Record the conversion
      if (!this.conversionLots.has(destAccount.id)) {
        this.conversionLots.set(destAccount.id, []);
      }

      const lots = this.conversionLots.get(destAccount.id)!;
      lots.push({
        year,
        amount: conversionAmount,
        penaltyFreeYear: year + 5,
      });

      // Add taxable occurrence for the conversion
      taxManager.addTaxableOccurrence(sourceAccount.id, {
        date: new Date(year, 11, 31), // Dec 31
        year,
        amount: conversionAmount,
        incomeType: 'retirement',
      });
    }
  }

  /**
   * Sort configs by priority (largerFirst or smallerFirst)
   */
  private sortConfigsByPriority(
    configs: RothConversionConfig[],
    balanceTracker: BalanceTracker,
  ): RothConversionConfig[] {
    return configs.sort((a, b) => {
      const accountA = this.accountManager.getAccountByName(a.sourceAccount);
      const accountB = this.accountManager.getAccountByName(b.sourceAccount);

      if (!accountA || !accountB) {
        return 0;
      }

      const balA = balanceTracker.getAccountBalance(accountA.id);
      const balB = balanceTracker.getAccountBalance(accountB.id);

      // Use the first config's priority for sorting (assumes all same priority)
      const priority = configs[0]?.priority ?? 'largerFirst';

      if (priority === 'largerFirst') {
        return balB - balA; // Larger balance first
      } else {
        return balA - balB; // Smaller balance first
      }
    });
  }

  /**
   * Get all conversion lots for an account
   * TODO #20: Integration with withdrawal handler for 5-year rule
   */
  public getConversionLots(accountId: string): ConversionLot[] {
    return this.conversionLots.get(accountId) || [];
  }

  /**
   * Get penalty-free balance from conversions (those past 5-year holding period)
   * TODO #20: Push/pull priority ordering based on penalty status
   */
  public getPenaltyFreeBalance(accountId: string, currentYear: number): number {
    const lots = this.conversionLots.get(accountId) || [];
    let penaltyFreeAmount = 0;

    for (const lot of lots) {
      if (lot.penaltyFreeYear <= currentYear) {
        penaltyFreeAmount += lot.amount;
      }
    }

    return penaltyFreeAmount;
  }

  /**
   * Get balance of conversions within 5-year period (subject to penalty)
   * TODO #20: Penalty calculation in withdrawal handler
   */
  public getPenaltyableBalance(accountId: string, currentYear: number): number {
    const lots = this.conversionLots.get(accountId) || [];
    let penaltyableAmount = 0;

    for (const lot of lots) {
      if (lot.penaltyFreeYear > currentYear) {
        penaltyableAmount += lot.amount;
      }
    }

    return penaltyableAmount;
  }

  /**
   * Calculate available liquid assets for paying conversion tax
   * Includes: accounts with performsPulls === true && usesRMD === false && not destination
   */
  private calculateLiquidAssets(excludeAccountId: string, balanceTracker: BalanceTracker): number {
    let totalLiquid = 0;

    for (const account of this.accountManager.getAllAccounts()) {
      if (account.id === excludeAccountId) {
        continue;
      }
      if (account.usesRMD) {
        // RMD accounts not liquid for this purpose
        continue;
      }
      if (!account.performsPulls) {
        // Only pull accounts can be used for tax payments
        continue;
      }

      const balance = balanceTracker.getAccountBalance(account.id);
      totalLiquid += Math.max(0, balance - (account.minimumBalance ?? 0));
    }

    return totalLiquid;
  }

  /**
   * Find which tax bracket a given rate falls into
   */
  private findBracketForRate(
    brackets: Array<{ min: number; max: number | null; rate: number }>,
    targetRate: number,
  ): { thresholdStart: number; thresholdEnd: number } | null {
    for (const bracket of brackets) {
      if (bracket.rate === targetRate) {
        return {
          thresholdStart: bracket.min,
          thresholdEnd: bracket.max ?? Number.MAX_SAFE_INTEGER,
        };
      }
    }
    return null;
  }

  public setBalanceTracker(balanceTracker: BalanceTracker): void {
    this.balanceTracker = balanceTracker;
  }
}
