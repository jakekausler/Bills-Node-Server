/**
 * Retirement calculation modules for pension and social security
 * 
 * This module handles complex retirement benefit calculations including
 * pension distributions, social security benefits, RMDs, and retirement
 * account management optimized for the new event-based system.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';
import { loadVariable } from '../simulation/variable';
import { Account } from '../../data/account/account';
import { getYearlyIncomes } from '../calculate/helpers';
import { AccountsAndTransfers } from '../../data/account/types';

dayjs.extend(utc);

/**
 * Pension calculation context
 */
interface PensionCalculationContext {
  pension: Pension;
  accountId: string;
  calculationDate: Date;
  simulation: string;
  accountsAndTransfers: AccountsAndTransfers;
  currentAge: number;
  yearlyIncomes: { year: number; amount: number }[];
}

/**
 * Social Security calculation context
 */
interface SocialSecurityCalculationContext {
  socialSecurity: SocialSecurity;
  accountId: string;
  calculationDate: Date;
  simulation: string;
  accountsAndTransfers: AccountsAndTransfers;
  currentAge: number;
  yearlyIncomes: { year: number; amount: number }[];
}

/**
 * RMD calculation context
 */
interface RMDCalculationContext {
  account: Account;
  calculationDate: Date;
  currentBalance: number;
  birthDate: Date;
  distributionAccountId: string;
}

/**
 * Retirement calculation result
 */
interface RetirementCalculationResult {
  amount: number;
  calculationMethod: string;
  activity: ConsolidatedActivity | null;
  nextPaymentDate: Date | null;
  metadata: {
    yearsOfService?: number;
    averageSalary?: number;
    benefitPercentage?: number;
    earningsHistory?: { year: number; amount: number }[];
    rmdLifeExpectancy?: number;
    rmdRequired?: boolean;
  };
}

/**
 * RMD table for life expectancy calculations
 */
const RMD_TABLE: { [age: number]: number } = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4,
  88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9,
  96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0, 102: 5.6, 103: 5.2,
  104: 4.9, 105: 4.6, 106: 4.3, 107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
  112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9
};

/**
 * Advanced retirement calculator
 */
export class RetirementCalculator {
  private pensionCache: Map<string, RetirementCalculationResult> = new Map();
  private socialSecurityCache: Map<string, RetirementCalculationResult> = new Map();
  private rmdCache: Map<string, RetirementCalculationResult> = new Map();
  private earningsCache: Map<string, { year: number; amount: number }[]> = new Map();

  /**
   * Calculates pension benefits
   */
  async calculatePension(context: PensionCalculationContext): Promise<RetirementCalculationResult> {
    const cacheKey = this.generatePensionCacheKey(context);
    const cached = this.pensionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.performPensionCalculation(context);
    this.pensionCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Performs pension calculation
   */
  private async performPensionCalculation(context: PensionCalculationContext): Promise<RetirementCalculationResult> {
    const { pension, accountId, calculationDate, simulation, accountsAndTransfers } = context;

    // Check if pension is active on this date
    if (calculationDate < pension.startDate || (pension.endDate && calculationDate > pension.endDate)) {
      return this.createZeroRetirementResult('Pension not active on this date', calculationDate);
    }

    // Calculate yearly incomes for pension calculation
    const yearlyIncomes = this.getYearlyIncomesForRetirement(accountsAndTransfers, pension);

    // Calculate pension amount based on method
    let pensionAmount = 0;
    let calculationMethod = 'unknown';
    let yearsOfService = 0;
    let averageSalary = 0;
    let benefitPercentage = 0;

    switch (pension.calculationMethod?.toLowerCase()) {
      case 'fixed':
        pensionAmount = await this.calculateFixedPension(pension, simulation);
        calculationMethod = 'Fixed amount';
        break;
        
      case 'percentage':
        const percentageResult = this.calculatePercentagePension(pension, yearlyIncomes);
        pensionAmount = percentageResult.amount;
        yearsOfService = percentageResult.yearsOfService;
        averageSalary = percentageResult.averageSalary;
        benefitPercentage = percentageResult.benefitPercentage;
        calculationMethod = 'Percentage of salary';
        break;
        
      case 'years_of_service':
        const serviceResult = this.calculateServiceBasedPension(pension, yearlyIncomes);
        pensionAmount = serviceResult.amount;
        yearsOfService = serviceResult.yearsOfService;
        averageSalary = serviceResult.averageSalary;
        calculationMethod = 'Years of service';
        break;
        
      default:
        pensionAmount = pension.amount || 0;
        calculationMethod = 'Direct amount';
    }

    // Apply any adjustments
    pensionAmount = this.applyPensionAdjustments(pensionAmount, pension, calculationDate);

    // Create activity if amount is significant
    let activity: ConsolidatedActivity | null = null;
    if (Math.abs(pensionAmount) >= 0.01) {
      activity = this.createPensionActivity(accountId, pension, pensionAmount, calculationDate);
    }

    // Calculate next payment date
    const nextPaymentDate = this.calculateNextPensionDate(pension, calculationDate);

    return {
      amount: pensionAmount,
      calculationMethod,
      activity,
      nextPaymentDate,
      metadata: {
        yearsOfService,
        averageSalary,
        benefitPercentage,
        earningsHistory: yearlyIncomes
      }
    };
  }

  /**
   * Calculates Social Security benefits
   */
  async calculateSocialSecurity(context: SocialSecurityCalculationContext): Promise<RetirementCalculationResult> {
    const cacheKey = this.generateSocialSecurityCacheKey(context);
    const cached = this.socialSecurityCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.performSocialSecurityCalculation(context);
    this.socialSecurityCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Performs Social Security calculation
   */
  private async performSocialSecurityCalculation(context: SocialSecurityCalculationContext): Promise<RetirementCalculationResult> {
    const { socialSecurity, accountId, calculationDate, simulation, accountsAndTransfers, currentAge } = context;

    // Check if Social Security is active
    if (calculationDate < socialSecurity.startDate || (socialSecurity.endDate && calculationDate > socialSecurity.endDate)) {
      return this.createZeroRetirementResult('Social Security not active on this date', calculationDate);
    }

    // Check minimum age requirement (typically 62)
    const minimumAge = 62;
    if (currentAge < minimumAge) {
      return this.createZeroRetirementResult('Below minimum Social Security age', calculationDate);
    }

    // Calculate yearly incomes for SS calculation
    const yearlyIncomes = this.getYearlyIncomesForRetirement(accountsAndTransfers, socialSecurity);

    // Calculate Social Security benefit
    let benefitAmount = 0;
    let calculationMethod = 'unknown';

    if (socialSecurity.calculationMethod?.toLowerCase() === 'fixed') {
      benefitAmount = await this.calculateFixedSocialSecurity(socialSecurity, simulation);
      calculationMethod = 'Fixed amount';
    } else {
      const ssResult = this.calculateEarningsBasedSocialSecurity(socialSecurity, yearlyIncomes, currentAge);
      benefitAmount = ssResult.amount;
      calculationMethod = 'Earnings-based calculation';
    }

    // Apply early or delayed retirement adjustments
    benefitAmount = this.applySocialSecurityAdjustments(benefitAmount, socialSecurity, currentAge);

    // Create activity if amount is significant
    let activity: ConsolidatedActivity | null = null;
    if (Math.abs(benefitAmount) >= 0.01) {
      activity = this.createSocialSecurityActivity(accountId, socialSecurity, benefitAmount, calculationDate);
    }

    // Calculate next payment date
    const nextPaymentDate = this.calculateNextSocialSecurityDate(socialSecurity, calculationDate);

    return {
      amount: benefitAmount,
      calculationMethod,
      activity,
      nextPaymentDate,
      metadata: {
        earningsHistory: yearlyIncomes
      }
    };
  }

  /**
   * Calculates Required Minimum Distribution (RMD)
   */
  async calculateRMD(context: RMDCalculationContext): Promise<RetirementCalculationResult> {
    const cacheKey = this.generateRMDCacheKey(context);
    const cached = this.rmdCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await this.performRMDCalculation(context);
    this.rmdCache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Performs RMD calculation
   */
  private async performRMDCalculation(context: RMDCalculationContext): Promise<RetirementCalculationResult> {
    const { account, calculationDate, currentBalance, birthDate, distributionAccountId } = context;

    // Calculate age at end of calculation year
    const calculationYear = dayjs.utc(calculationDate).year();
    const ageAtYearEnd = calculationYear - dayjs.utc(birthDate).year();

    // RMD starts at age 72 for most accounts
    const rmdStartAge = this.getRMDStartAge(account);
    
    if (ageAtYearEnd < rmdStartAge) {
      return this.createZeroRetirementResult('Below RMD age requirement', calculationDate);
    }

    // Only calculate RMD on December 31st
    if (!dayjs.utc(calculationDate).isSame(dayjs.utc(calculationDate).endOf('year'), 'day')) {
      return this.createZeroRetirementResult('RMD calculated only on December 31st', calculationDate);
    }

    // Get life expectancy factor
    const lifeExpectancy = RMD_TABLE[ageAtYearEnd] || 3.0; // Use minimum if age not in table
    
    // Calculate RMD amount
    const rmdAmount = currentBalance / lifeExpectancy;

    // Create RMD activity
    let activity: ConsolidatedActivity | null = null;
    if (rmdAmount >= 0.01) {
      activity = this.createRMDActivity(account, distributionAccountId, rmdAmount, calculationDate);
    }

    return {
      amount: rmdAmount,
      calculationMethod: `RMD calculation (age ${ageAtYearEnd}, life expectancy ${lifeExpectancy})`,
      activity,
      nextPaymentDate: dayjs.utc(calculationDate).add(1, 'year').endOf('year').toDate(),
      metadata: {
        rmdLifeExpectancy: lifeExpectancy,
        rmdRequired: true
      }
    };
  }

  // Helper methods for pension calculations

  private async calculateFixedPension(pension: Pension, simulation: string): Promise<number> {
    if (pension.amountIsVariable && pension.amountVariable) {
      const variableValue = loadVariable(pension.amountVariable, simulation);
      if (typeof variableValue === 'number') {
        return variableValue;
      }
    }
    return pension.amount || 0;
  }

  private calculatePercentagePension(pension: Pension, yearlyIncomes: { year: number; amount: number }[]): {
    amount: number;
    yearsOfService: number;
    averageSalary: number;
    benefitPercentage: number;
  } {
    if (yearlyIncomes.length === 0) {
      return { amount: 0, yearsOfService: 0, averageSalary: 0, benefitPercentage: 0 };
    }

    const yearsOfService = yearlyIncomes.length;
    const totalEarnings = yearlyIncomes.reduce((sum, income) => sum + income.amount, 0);
    const averageSalary = totalEarnings / yearsOfService;
    const benefitPercentage = pension.benefitPercentage || 2; // Default 2% per year
    
    const totalBenefitPercentage = (benefitPercentage / 100) * yearsOfService;
    const amount = averageSalary * totalBenefitPercentage;

    return {
      amount,
      yearsOfService,
      averageSalary,
      benefitPercentage: totalBenefitPercentage * 100
    };
  }

  private calculateServiceBasedPension(pension: Pension, yearlyIncomes: { year: number; amount: number }[]): {
    amount: number;
    yearsOfService: number;
    averageSalary: number;
  } {
    if (yearlyIncomes.length === 0) {
      return { amount: 0, yearsOfService: 0, averageSalary: 0 };
    }

    const yearsOfService = yearlyIncomes.length;
    
    // Use highest consecutive years for calculation (typically 3-5 years)
    const highestYears = pension.highestYears || 3;
    const sortedIncomes = [...yearlyIncomes].sort((a, b) => b.amount - a.amount);
    const topIncomes = sortedIncomes.slice(0, Math.min(highestYears, sortedIncomes.length));
    
    const averageSalary = topIncomes.reduce((sum, income) => sum + income.amount, 0) / topIncomes.length;
    const multiplier = pension.serviceMultiplier || 0.02; // Default 2% per year
    
    const amount = averageSalary * multiplier * yearsOfService;

    return {
      amount,
      yearsOfService,
      averageSalary
    };
  }

  private applyPensionAdjustments(baseAmount: number, pension: Pension, date: Date): number {
    let adjustedAmount = baseAmount;

    // Apply COLA (Cost of Living Adjustment)
    if (pension.colaRate && pension.colaRate > 0) {
      const yearsFromStart = dayjs.utc(date).diff(dayjs.utc(pension.startDate), 'year', true);
      if (yearsFromStart > 0) {
        const colaMultiplier = Math.pow(1 + pension.colaRate / 100, yearsFromStart);
        adjustedAmount *= colaMultiplier;
      }
    }

    return adjustedAmount;
  }

  // Helper methods for Social Security calculations

  private async calculateFixedSocialSecurity(socialSecurity: SocialSecurity, simulation: string): Promise<number> {
    if (socialSecurity.amountIsVariable && socialSecurity.amountVariable) {
      const variableValue = loadVariable(socialSecurity.amountVariable, simulation);
      if (typeof variableValue === 'number') {
        return variableValue;
      }
    }
    return socialSecurity.amount || 0;
  }

  private calculateEarningsBasedSocialSecurity(
    socialSecurity: SocialSecurity, 
    yearlyIncomes: { year: number; amount: number }[], 
    currentAge: number
  ): { amount: number } {
    if (yearlyIncomes.length === 0) {
      return { amount: 0 };
    }

    // Simplified Social Security calculation
    // Real calculation would use bend points, wage indexing, etc.
    
    // Use highest 35 years of earnings
    const sortedIncomes = [...yearlyIncomes].sort((a, b) => b.amount - a.amount);
    const top35Years = sortedIncomes.slice(0, Math.min(35, sortedIncomes.length));
    
    const totalEarnings = top35Years.reduce((sum, income) => sum + income.amount, 0);
    const averageEarnings = totalEarnings / 35; // Divide by 35 even if fewer years
    
    // Simplified benefit calculation (real formula is much more complex)
    const monthlyBenefit = averageEarnings * 0.4 / 12; // Approximately 40% of average monthly earnings
    
    return { amount: monthlyBenefit };
  }

  private applySocialSecurityAdjustments(baseAmount: number, socialSecurity: SocialSecurity, currentAge: number): number {
    let adjustedAmount = baseAmount;

    // Full retirement age is typically 67 for people born 1960 or later
    const fullRetirementAge = socialSecurity.fullRetirementAge || 67;
    
    if (currentAge < fullRetirementAge) {
      // Early retirement reduction (approximately 6.67% per year before full retirement age)
      const yearsEarly = fullRetirementAge - currentAge;
      const reductionRate = 0.0667; // 6.67% per year
      const totalReduction = Math.min(yearsEarly * reductionRate, 0.25); // Maximum 25% reduction
      adjustedAmount *= (1 - totalReduction);
    } else if (currentAge > fullRetirementAge) {
      // Delayed retirement credits (8% per year after full retirement age until age 70)
      const yearsDelayed = Math.min(currentAge - fullRetirementAge, 3); // Max 3 years (until age 70)
      const creditRate = 0.08; // 8% per year
      adjustedAmount *= (1 + yearsDelayed * creditRate);
    }

    return adjustedAmount;
  }

  // Helper methods for RMD calculations

  private getRMDStartAge(account: Account): number {
    // RMD start age changed from 70.5 to 72 in 2020
    return 72;
  }

  // Activity creation methods

  private createPensionActivity(accountId: string, pension: Pension, amount: number, date: Date): ConsolidatedActivity {
    return new ConsolidatedActivity({
      id: `PENSION-${pension.id}-${date.getTime()}`,
      name: `Pension - ${pension.name || 'Pension'}`,
      amount: amount,
      amountIsVariable: pension.amountIsVariable || false,
      amountVariable: pension.amountVariable,
      date: formatDate(date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Income.Pension',
      flag: false,
      flagColor: null
    });
  }

  private createSocialSecurityActivity(accountId: string, socialSecurity: SocialSecurity, amount: number, date: Date): ConsolidatedActivity {
    return new ConsolidatedActivity({
      id: `SS-${socialSecurity.id}-${date.getTime()}`,
      name: `Social Security - ${socialSecurity.name || 'Social Security'}`,
      amount: amount,
      amountIsVariable: socialSecurity.amountIsVariable || false,
      amountVariable: socialSecurity.amountVariable,
      date: formatDate(date),
      dateIsVariable: false,
      dateVariable: null,
      from: null,
      to: null,
      isTransfer: false,
      category: 'Income.SocialSecurity',
      flag: false,
      flagColor: null
    });
  }

  private createRMDActivity(account: Account, distributionAccountId: string, amount: number, date: Date): ConsolidatedActivity {
    return new ConsolidatedActivity({
      id: `RMD-${account.id}-${date.getTime()}`,
      name: `Required Minimum Distribution - ${account.name}`,
      amount: -amount, // Negative for withdrawal from retirement account
      amountIsVariable: false,
      amountVariable: null,
      date: formatDate(date),
      dateIsVariable: false,
      dateVariable: null,
      from: account.name,
      to: null, // Would be the distribution account
      isTransfer: true,
      category: 'Banking.RMD',
      flag: true,
      flagColor: 'red'
    });
  }

  // Date calculation methods

  private calculateNextPensionDate(pension: Pension, currentDate: Date): Date | null {
    if (!pension.frequency) return null;
    
    // Most pensions are monthly
    return dayjs.utc(currentDate).add(1, 'month').toDate();
  }

  private calculateNextSocialSecurityDate(socialSecurity: SocialSecurity, currentDate: Date): Date | null {
    if (!socialSecurity.frequency) return null;
    
    // Social Security is typically monthly
    return dayjs.utc(currentDate).add(1, 'month').toDate();
  }

  // Utility methods

  private getYearlyIncomesForRetirement(accountsAndTransfers: AccountsAndTransfers, retirement: Pension | SocialSecurity): { year: number; amount: number }[] {
    const cacheKey = `${retirement.id}_${retirement.workStartDate?.getTime()}_${retirement.startDate.getTime()}`;
    
    let cached = this.earningsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const yearlyIncomes = getYearlyIncomes(accountsAndTransfers, retirement);
    this.earningsCache.set(cacheKey, yearlyIncomes);
    
    return yearlyIncomes;
  }

  private createZeroRetirementResult(reason: string, date: Date): RetirementCalculationResult {
    return {
      amount: 0,
      calculationMethod: reason,
      activity: null,
      nextPaymentDate: null,
      metadata: {}
    };
  }

  // Cache key generation

  private generatePensionCacheKey(context: PensionCalculationContext): string {
    return `pension_${context.pension.id}_${context.accountId}_${context.calculationDate.getTime()}_${context.simulation}`;
  }

  private generateSocialSecurityCacheKey(context: SocialSecurityCalculationContext): string {
    return `ss_${context.socialSecurity.id}_${context.accountId}_${context.calculationDate.getTime()}_${context.simulation}`;
  }

  private generateRMDCacheKey(context: RMDCalculationContext): string {
    return `rmd_${context.account.id}_${context.calculationDate.getTime()}_${context.currentBalance}`;
  }

  /**
   * Gets retirement calculation statistics
   */
  getStats(): {
    pensionCalculations: number;
    socialSecurityCalculations: number;
    rmdCalculations: number;
    cacheSize: number;
    earningsCacheSize: number;
  } {
    return {
      pensionCalculations: this.pensionCache.size,
      socialSecurityCalculations: this.socialSecurityCache.size,
      rmdCalculations: this.rmdCache.size,
      cacheSize: this.pensionCache.size + this.socialSecurityCache.size + this.rmdCache.size,
      earningsCacheSize: this.earningsCache.size
    };
  }

  /**
   * Clears all caches
   */
  clearCache(): void {
    this.pensionCache.clear();
    this.socialSecurityCache.clear();
    this.rmdCache.clear();
    this.earningsCache.clear();
  }

  /**
   * Validates retirement configuration
   */
  validateRetirementConfig(retirement: Pension | SocialSecurity): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!retirement.id) {
      errors.push('Retirement benefit must have an ID');
    }

    if (!retirement.startDate) {
      errors.push('Retirement benefit must have a start date');
    }

    if (retirement.endDate && retirement.startDate && retirement.endDate <= retirement.startDate) {
      errors.push('End date must be after start date');
    }

    if (retirement instanceof Pension) {
      if (retirement.calculationMethod === 'percentage' && !retirement.benefitPercentage) {
        errors.push('Percentage-based pension must specify benefit percentage');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}