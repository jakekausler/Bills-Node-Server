import { readFileSync } from 'fs';
import { join } from 'path';
import { TaxManager } from './tax-manager';
import { BalanceTracker } from './balance-tracker';
import { AccountManager } from './account-manager';
import { AcaManager } from './aca-manager';
import { FilingStatus, getBracketDataForYear } from './bracket-calculator';
import { loadDateOrVariable } from '../simulation/loadVariableValue';
import { loadVariable } from '../simulation/variable';
import dayjs from 'dayjs';
import type { DebugLogger } from './debug-logger';
import type { SegmentResult } from './types';

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

export interface ConversionResult {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  year: number;
}

export class RothConversionManager {
  private configs: RothConversionConfig[] = [];
  private conversionLots: Map<string, ConversionLot[]> = new Map();
  private accountManager: AccountManager;
  private acaManager: AcaManager | null = null;
  private conversionsThisYear: ConversionResult[] = [];
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(accountManager: AccountManager, acaManager?: AcaManager, debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.accountManager = accountManager;
    this.acaManager = acaManager || null;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.loadConfig();
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'roth-conversion', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
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
   * Returns array of conversions that actually happened.
   *
   */
  /** Key used to store conversion taxable occurrences so they can be cleared on reprocess */
  private static readonly CONVERSION_TAX_KEY = '__roth_conversion__';

  public processConversions(
    year: number,
    taxManager: TaxManager,
    balanceTracker: BalanceTracker,
    filingStatus: FilingStatus = 'mfj',
    inflationRate: number = 0.03,
    simulation: string = 'default',
    segmentResult?: SegmentResult,
  ): ConversionResult[] {
    this.conversionsThisYear = [];
    this.currentDate = `${year}-12-31`;
    this.log('processing-started', { year, config_count: this.configs?.length ?? 0 });
    if (!this.configs || this.configs.length === 0) {
      return [];
    }

    // Clear any conversion occurrences from a prior pass (segment reprocessing)
    // so that we don't double-count conversion income when calculating bracket space
    taxManager.clearTaxableOccurrences(RothConversionManager.CONVERSION_TAX_KEY, year);
    this.log('prior-cleared', { year });

    // Filter and sort enabled configs by priority
    const enabledConfigs = this.configs.filter(c => c.enabled);
    const sortedConfigs = this.sortConfigsByPriority(enabledConfigs, balanceTracker, segmentResult);

    for (const config of sortedConfigs) {
      // Load start/end dates from variables
      const startDateResult = loadDateOrVariable(null, true, config.startDateVariable, simulation);
      const endDateResult = loadDateOrVariable(null, true, config.endDateVariable, simulation);

      const startDate = startDateResult.date ? startDateResult.date.getUTCFullYear() : null;
      const endDate = endDateResult.date ? endDateResult.date.getUTCFullYear() : null;

      // Skip if current year is outside the conversion window
      const inWindow = (startDate === null || year >= startDate) && (endDate === null || year <= endDate);
      this.log('window-check', { year, start_year: startDate, end_year: endDate, in_window: inWindow });
      if (startDate !== null && year < startDate) continue;
      if (endDate !== null && year > endDate) continue;

      // Get source and destination accounts
      const sourceAccount = this.accountManager.getAccountByName(config.sourceAccount);
      const destAccount = this.accountManager.getAccountByName(config.destinationAccount);

      this.log('account-lookup', {
        source: config.sourceAccount,
        destination: config.destinationAccount,
        source_found: !!sourceAccount,
        dest_found: !!destAccount,
      });

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

      this.log('bracket-space-calculated', {
        year,
        ordinary_income: ordinaryIncome,
        standard_deduction: standardDeduction,
        taxable_income: taxableIncome,
        target_bracket: config.targetBracketRate,
        remaining_space: remainingSpace,
      });

      if (remainingSpace <= 0) {
        // Already at or above target bracket
        this.log('insufficient-space', {
          year,
          taxable_income: taxableIncome,
          target_bracket: config.targetBracketRate,
          reason: 'already at or above target bracket',
        });
        continue;
      }

      // Check source account has funds (use effective balance to account for in-flight segment changes)
      const sourceBalance = balanceTracker.getEffectiveBalance(sourceAccount.id, segmentResult);
      if (sourceBalance <= 0) {
        continue;
      }

      // Determine conversion amount: min of source balance and remaining bracket space
      let conversionAmount = Math.min(sourceBalance, remainingSpace);
      this.log('conversion-amount-set', {
        source_balance: sourceBalance,
        bracket_space: remainingSpace,
        conversion_amount: conversionAmount,
      });
      let effectiveMarginalRate = config.targetBracketRate;

      // Task 6: Check ACA subsidy loss if in ACA period
      if (this.acaManager) {
        try {
          // Determine if we're in ACA period during year+1 (when this year's MAGI affects ACA subsidy)
          const retireDateResult = loadVariable('RETIRE_DATE', simulation);
          const retireYear = retireDateResult instanceof Date ? retireDateResult.getUTCFullYear() : null;

          // Load real birth dates from Social Security configs
          let birthDate1: Date | null = null;
          let birthDate2: Date | null = null;
          let age65Year1: number | null = null;
          let age65Year2: number | null = null;

          try {
            const birthDateResult1 = loadVariable('JAKE_BIRTH_DATE', simulation);
            if (birthDateResult1 instanceof Date) {
              birthDate1 = birthDateResult1;
              age65Year1 = dayjs.utc(birthDate1).add(65, 'year').year();
            }
          } catch (e) {
            // Birth date variable not found, skip ACA check
          }

          try {
            const birthDateResult2 = loadVariable('KENDALL_BIRTH_DATE', simulation);
            if (birthDateResult2 instanceof Date) {
              birthDate2 = birthDateResult2;
              age65Year2 = dayjs.utc(birthDate2).add(65, 'year').year();
            }
          } catch (e) {
            // Birth date variable not found, skip ACA check
          }

          // Use the later (max) age 65 year (last person to reach Medicare eligibility)
          const age65Year = age65Year1 !== null && age65Year2 !== null ? Math.max(age65Year1, age65Year2) : null;

          // Only check ACA if we have both retire date and age 65 year
          if (retireYear !== null && age65Year !== null && birthDate1 !== null && birthDate2 !== null) {
            // Conversion in December of year N affects MAGI for year N, which affects ACA subsidy in year N+1
            const nextYear = year + 1;

            // COBRA covers the first 18 months after retirement; ACA only starts after COBRA ends.
            // During COBRA years, premiums are fixed-cost with no income-based subsidy, so the
            // ACA subsidy check should not apply.
            const retireDateObj = retireDateResult instanceof Date ? retireDateResult : null;
            const cobraEndDate = retireDateObj ? dayjs.utc(retireDateObj).add(18, 'month') : null;
            const nextYearStart = dayjs.utc(new Date(Date.UTC(nextYear, 0, 1)));
            const afterCobra = cobraEndDate ? nextYearStart.isAfter(cobraEndDate) || nextYearStart.isSame(cobraEndDate) : true;

            const inAcaPeriodNextYear = nextYear >= retireYear && nextYear <= age65Year && afterCobra;

            if (inAcaPeriodNextYear) {
              // Get current year's income (MAGI for next year ACA subsidy calculation)
              const currentMAGI = ordinaryIncome;

              // Calculate real ages for next year (July 1 age convention)
              const age1NextYear = dayjs.utc(new Date(Date.UTC(year + 1, 6, 1))).diff(birthDate1, 'year');
              const age2NextYear = dayjs.utc(new Date(Date.UTC(year + 1, 6, 1))).diff(birthDate2, 'year');
              const grossPremiumNextYear = this.acaManager.getAcaCoupleGrossPremium(
                age1NextYear,
                age2NextYear,
                nextYear
              );

              // Calculate subsidy before and after conversion
              const subsidyBefore = this.acaManager.calculateMonthlySubsidy(
                currentMAGI,
                2, // household size
                nextYear,
                grossPremiumNextYear
              );

              const subsidyAfter = this.acaManager.calculateMonthlySubsidy(
                currentMAGI + conversionAmount,
                2,
                nextYear,
                grossPremiumNextYear
              );

              // Annual subsidy loss = monthly difference × 12
              const annualSubsidyLoss = Math.max(0, (subsidyBefore - subsidyAfter) * 12);

              this.log('aca-subsidy-checked', {
                next_year: nextYear,
                current_magi: currentMAGI,
                subsidy_before: subsidyBefore,
                subsidy_after: subsidyAfter,
                annual_loss: annualSubsidyLoss,
                effective_rate: conversionAmount > 0 ? annualSubsidyLoss / conversionAmount : 0,
              });

              if (annualSubsidyLoss > 0 && conversionAmount > 0) {
                // Effective marginal rate includes subsidy loss
                const subsidyLossRate = annualSubsidyLoss / conversionAmount;
                effectiveMarginalRate = config.targetBracketRate + subsidyLossRate;

                // If combined rate exceeds target + 5%, binary search for max acceptable conversion
                const rateThreshold = config.targetBracketRate + 0.05;
                if (effectiveMarginalRate > rateThreshold) {
                  // Binary search: find largest conversion where effective rate <= threshold
                  let lo = 0;
                  let hi = conversionAmount;
                  let bestAmount = 0;

                  for (let iter = 0; iter < 20; iter++) {
                    const mid = (lo + hi) / 2;
                    if (mid < 100) {
                      // Too small to matter
                      hi = mid;
                      continue;
                    }

                    const midSubsidyAfter = this.acaManager!.calculateMonthlySubsidy(
                      currentMAGI + mid,
                      2,
                      nextYear,
                      grossPremiumNextYear
                    );
                    const midAnnualLoss = Math.max(0, (subsidyBefore - midSubsidyAfter) * 12);
                    const midEffectiveRate = config.targetBracketRate + (midAnnualLoss / mid);

                    if (midEffectiveRate <= rateThreshold) {
                      bestAmount = mid;
                      lo = mid;
                    } else {
                      hi = mid;
                    }
                  }

                  this.log('aca-reduction-search', {
                    original_amount: conversionAmount,
                    reduced_amount: bestAmount,
                    threshold: rateThreshold,
                  });

                  conversionAmount = Math.floor(bestAmount);

                  // If conversion reduced to near-zero, skip this year
                  if (conversionAmount < 100) {
                    this.log('aca-conversion-skipped', {
                      year,
                      reason: 'subsidy loss makes conversion not worthwhile',
                      effective_rate: effectiveMarginalRate,
                    });
                    continue;
                  }
                }
              }
            }
          }
        } catch (e) {
          // If any variable loading fails, proceed without ACA check
        }
      }

      // Note: Tax on the conversion is handled by the normal tax event (Apr 15 next year).
      // The push/pull handler covers any deficit created by the tax payment, so we do not
      // gate conversions on current liquid-account balances.

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

      this.log('lot-recorded', {
        destination: destAccount.id,
        amount: conversionAmount,
        year,
        penalty_free_year: year + 5,
      });

      // Track this conversion for activity creation
      this.conversionsThisYear.push({
        sourceAccountId: sourceAccount.id,
        destinationAccountId: destAccount.id,
        amount: conversionAmount,
        year,
      });

      this.log('conversion-completed', {
        year,
        source: sourceAccount.id,
        destination: destAccount.id,
        amount: conversionAmount,
      });

      // Add taxable occurrence for the conversion using a dedicated key
      // so we can clear just these on segment reprocessing
      taxManager.addTaxableOccurrence(RothConversionManager.CONVERSION_TAX_KEY, {
        date: new Date(year, 11, 31), // Dec 31
        year,
        amount: conversionAmount,
        incomeType: 'retirement',
      });
    }

    return this.conversionsThisYear;
  }

  /**
   * Sort configs by priority (largerFirst or smallerFirst)
   */
  private sortConfigsByPriority(
    configs: RothConversionConfig[],
    balanceTracker: BalanceTracker,
    segmentResult?: SegmentResult,
  ): RothConversionConfig[] {
    return configs.sort((a, b) => {
      const accountA = this.accountManager.getAccountByName(a.sourceAccount);
      const accountB = this.accountManager.getAccountByName(b.sourceAccount);

      if (!accountA || !accountB) {
        return 0;
      }

      const balA = balanceTracker.getEffectiveBalance(accountA.id, segmentResult);
      const balB = balanceTracker.getEffectiveBalance(accountB.id, segmentResult);

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
   */
  public getConversionLots(accountId: string): ConversionLot[] {
    return this.conversionLots.get(accountId) || [];
  }

  /**
   * Get penalty-free balance from conversions (those past 5-year holding period)
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

  /** @deprecated No longer needed — kept for API compatibility */
  public setBalanceTracker(_balanceTracker: BalanceTracker): void {
    // No-op: liquid-asset gating removed; tax is paid via normal tax event + push/pull
  }
}
