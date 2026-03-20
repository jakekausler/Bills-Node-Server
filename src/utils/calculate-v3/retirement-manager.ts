import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { RMDTableType } from '../calculate/types';
import { HistoricRates, MCRateGetter, MonteCarloSampleType } from './types';
import { loadAverageWageIndex } from '../io/averageWageIndex';
import { loadBendPoints } from '../io/bendPoints';
import { load } from '../io/io';
import type { DebugLogger } from './debug-logger';

// Module-level caches for expensive disk I/O operations
let cachedWageIndex: Record<number, number> | null = null;
let cachedBendPoints: Record<number, { first: number; second: number }> | null = null;
let cachedRMDTable: RMDTableType | null = null;
let cachedHistoricRates: HistoricRates | null = null;

const SS_WAGE_BASE_2025 = 176100;
// Historical average NAWI (National Average Wage Index) growth rate
const NAWI_GROWTH_RATE = 0.035;

/**
 * Load historic rates from data file (cached at module level)
 */
function getHistoricRates(): HistoricRates {
  if (!cachedHistoricRates) {
    cachedHistoricRates = load<HistoricRates>('historicRates.json');
  }
  return cachedHistoricRates;
}

/**
 * Calculate the Social Security taxable wage base cap for a given year.
 * Uses historical data when available, then:
 * - MC mode: compounds from latest known year using SS_WAGE_BASE_CHANGE draws
 * - Deterministic: inflates at 3.5% annually from 2025
 */
function getWageBaseCap(year: number, mcRateGetter?: MCRateGetter | null): number {
  const historicRates = getHistoricRates();

  // Use historical data if available
  if (historicRates.ssWageBase) {
    const yearStr = String(year);
    if (yearStr in historicRates.ssWageBase) {
      return historicRates.ssWageBase[yearStr];
    }
  }

  // Find the latest known year in historical data
  let latestKnownYear = 2025;
  let latestKnownValue = SS_WAGE_BASE_2025;
  if (historicRates.ssWageBase) {
    const knownYears = Object.keys(historicRates.ssWageBase).map(Number).sort((a, b) => b - a);
    if (knownYears.length > 0) {
      latestKnownYear = knownYears[0];
      latestKnownValue = historicRates.ssWageBase[String(latestKnownYear)];
    }
  }

  if (year <= latestKnownYear) {
    // Edge case: year before data start. Should not happen in normal operation.
    return SS_WAGE_BASE_2025;
  }

  // MC mode: compound year-by-year using SS_WAGE_BASE_CHANGE draws (ratios like 1.098)
  if (mcRateGetter) {
    let cap = latestKnownValue;
    for (let y = latestKnownYear + 1; y <= year; y++) {
      const ratio = mcRateGetter(MonteCarloSampleType.SS_WAGE_BASE_CHANGE, y);
      cap *= (ratio !== null ? ratio : (1 + NAWI_GROWTH_RATE));
    }
    return Math.round(cap);
  }

  // Deterministic: inflate from latest known year at fixed rate
  const yearsFromBase = year - latestKnownYear;
  return Math.round(latestKnownValue * Math.pow(1 + NAWI_GROWTH_RATE, yearsFromBase));
}

/**
 * Clears all module-level caches for retirement data.
 * Used by the cache-clear endpoint to force re-reads from disk.
 */
export function clearRetirementCache() {
  cachedWageIndex = null;
  cachedBendPoints = null;
  cachedRMDTable = null;
  cachedHistoricRates = null;
}

export class RetirementManager {
  // List of social securities
  private socialSecurities: SocialSecurity[];
  // List of pensions
  private pensions: Pension[];
  // A map of valid income names to their social security
  private validIncomeNamesToSocialSecurity: Map<string, SocialSecurity> = new Map();
  // A map of valid income names to their pension
  private validIncomeNamesToPension: Map<string, Pension> = new Map();
  // A map of annual incomes for each social security indexed by social security name and year
  private socialSecurityAnnualIncomes: Map<string, Map<number, number>> = new Map();
  // A map of annual incomes for each pension indexed by pension name and year
  private pensionAnnualIncomes: Map<string, Map<number, number>> = new Map();
  // the monthly pay for each social security indexed by social security name
  private socialSecurityMonthlyPay: Map<string, number> = new Map();
  // the monthly pay for each pension indexed by pension name
  private pensionMonthlyPay: Map<string, number> = new Map();
  // the first payment year for each pension indexed by pension name
  private pensionFirstPaymentYear: Map<string, number> = new Map();
  // the first payment year for each social security indexed by social security name
  private socialSecurityFirstPaymentYear: Map<string, number> = new Map();
  // RMD table
  private rmdTable: RMDTableType;

  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private mcRateGetter: MCRateGetter | null = null;

  constructor(socialSecurities: SocialSecurity[], pensions: Pension[], debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.socialSecurities = socialSecurities;
    this.pensions = pensions;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
    this.initializeSocialSecurity();
    this.initializePension();
    this.rmdTable = this.loadRMDTable();
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'retirement', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  /** Set the MC rate getter for sampling SS wage base and AWI growth in MC mode */
  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetter = getter;
  }

  private initializeSocialSecurity() {
    this.socialSecurities.forEach((socialSecurity) => {
      // Fill the annual incomes for each year from the minimum year in the data to the social security start date year
      const minYear = Math.min(...socialSecurity.priorAnnualNetIncomeYears);
      for (let year = minYear; year <= socialSecurity.startDate.getUTCFullYear(); year++) {
        // Get the annual income for the year, if it exists in the priorAnnualNetIncomeYears, otherwise use 0 (in which case it will be added to the annual income map as calculated later)
        const priorYearIndex = socialSecurity.priorAnnualNetIncomeYears.indexOf(year);
        const annualIncome = priorYearIndex !== -1 ? socialSecurity.priorAnnualNetIncomes[priorYearIndex] : 0;
        this.addSocialSecurityAnnualIncome(socialSecurity.name, year, annualIncome);
      }
      // Initialize the monthly pay for this social security
      this.socialSecurityMonthlyPay.set(socialSecurity.name, 0);
      // Add the social security to the valid income names to social security map
      socialSecurity.paycheckNames.forEach((paycheckName) => {
        this.validIncomeNamesToSocialSecurity.set(paycheckName, socialSecurity);
      });
      this.log('ss-initialized', { name: socialSecurity.name, year_count: this.socialSecurityAnnualIncomes.get(socialSecurity.name)?.size ?? 0 });
    });
  }

  private initializePension() {
    this.pensions.forEach((pension) => {
      // Fill the annual incomes for each year from the minimum year in the data to the pension start date year
      const minYear = Math.min(...pension.priorAnnualNetIncomeYears);
      for (let year = minYear; year <= pension.startDate.getUTCFullYear(); year++) {
        // Get the annual income for the year, if it exists in the priorAnnualNetIncomeYears, otherwise use 0 (in which case it will be added to the annual income map as calculated later)
        const priorYearIndex = pension.priorAnnualNetIncomeYears.indexOf(year);
        const annualIncome = priorYearIndex !== -1 ? pension.priorAnnualNetIncomes[priorYearIndex] : 0;
        this.addPensionAnnualIncome(pension.name, year, annualIncome);
      }
      // Initialize the monthly pay for this pension
      this.pensionMonthlyPay.set(pension.name, 0);
      // Add the pension to the valid income names to pension map
      pension.paycheckNames.forEach((paycheckName) => {
        this.validIncomeNamesToPension.set(paycheckName, pension);
      });
      this.log('pension-initialized', { name: pension.name, year_count: this.pensionAnnualIncomes.get(pension.name)?.size ?? 0 });
    });
  }

  public tryAddToAnnualIncomes(activityName: string, date: Date, income: number) {
    this.tryAddSocialSecurityAnnualIncome(activityName, date, income);
    this.tryAddPensionAnnualIncome(activityName, date, income);
  }

  private tryAddSocialSecurityAnnualIncome(activityName: string, date: Date, income: number) {
    const socialSecurity = this.validIncomeNamesToSocialSecurity.get(activityName);
    if (socialSecurity) {
      this.addSocialSecurityAnnualIncome(socialSecurity.name, date.getUTCFullYear(), income);
    }
  }

  private addSocialSecurityAnnualIncome(name: string, year: number, income: number) {
    // Ensure the map for this social security exists
    if (!this.socialSecurityAnnualIncomes.has(name)) {
      this.socialSecurityAnnualIncomes.set(name, new Map());
    }
    // Add the income for the year, summing with any prior balance
    const priorBalance = this.socialSecurityAnnualIncomes.get(name)?.get(year) || 0;
    const totalIncome = income + priorBalance;
    // Apply the Social Security taxable wage base cap
    const wageBaseCap = getWageBaseCap(year, this.mcRateGetter);
    const cappedIncome = Math.min(totalIncome, wageBaseCap);
    if (totalIncome > wageBaseCap) {
      this.log('wage-base-capped', { year, total_income: totalIncome, wage_base_cap: wageBaseCap, capped_income: cappedIncome });
    }
    this.socialSecurityAnnualIncomes.get(name)?.set(year, cappedIncome);
  }

  private tryAddPensionAnnualIncome(activityName: string, date: Date, income: number) {
    const pension = this.validIncomeNamesToPension.get(activityName);
    if (pension) {
      this.addPensionAnnualIncome(pension.name, date.getUTCFullYear(), income);
    }
  }

  private addPensionAnnualIncome(name: string, year: number, income: number) {
    // Ensure the map for this pension exists
    if (!this.pensionAnnualIncomes.has(name)) {
      this.pensionAnnualIncomes.set(name, new Map());
    }
    // Add the income for the year, summing with any prior balance
    const priorBalance = this.pensionAnnualIncomes.get(name)?.get(year) || 0;
    this.pensionAnnualIncomes.get(name)?.set(year, income + priorBalance);
  }

  public calculateSocialSecurityMonthlyPay(socialSecurity: SocialSecurity): void {
    const aime = this.calculateAIME(socialSecurity);
    const pia = this.computePIA(socialSecurity.yearTurn60 + 2, aime);
    const birthYear = socialSecurity.birthDate.getUTCFullYear();
    const factorForCollectionAge = this.factorForCollectionAge(socialSecurity.collectionAge, birthYear);
    let monthlyPay = pia * factorForCollectionAge;

    this.log('ss-monthly-calculated', { name: socialSecurity.name, monthly_pay: monthlyPay, collection_age: socialSecurity.collectionAge, factor: factorForCollectionAge });

    // Apply spousal benefit if spouse exists and their benefit has been calculated
    // TODO #26: Store raw PIA for more accurate spousal benefit calculation (currently using adjusted monthly pay as approximation)
    if (socialSecurity.spouseName) {
      const spouseMonthlyPay = this.socialSecurityMonthlyPay.get(socialSecurity.spouseName);
      if (spouseMonthlyPay && spouseMonthlyPay > 0) {
        // Spousal benefit = 50% of spouse's monthly pay (approximates 50% of PIA with claiming age adjustments)
        const spousalBenefit = spouseMonthlyPay * 0.5;
        // Lower-earning spouse gets the higher of their own benefit or spousal benefit
        const ownBenefit = monthlyPay;
        monthlyPay = Math.max(monthlyPay, spousalBenefit);
        this.log('spousal-benefit-checked', { name: socialSecurity.name, own_benefit: ownBenefit, spousal_benefit: spousalBenefit, result: monthlyPay });
      }
    }

    this.socialSecurityMonthlyPay.set(socialSecurity.name, monthlyPay);
  }

  public calculatePensionMonthlyPay(pension: Pension, startYear?: number): void {
    const highestCompensationAverage = this.getHighestCompensationAverage(pension);
    const monthlyPay =
      (highestCompensationAverage * pension.accrualFactor * pension.yearsWorked * pension.reductionFactor) / 12;
    this.log('pension-monthly-calculated', { name: pension.name, monthly_pay: monthlyPay, avg_compensation: highestCompensationAverage, years_worked: pension.yearsWorked });
    this.pensionMonthlyPay.set(pension.name, monthlyPay);
    if (startYear !== undefined) {
      this.pensionFirstPaymentYear.set(pension.name, startYear);
    }
  }

  public getSocialSecurityMonthlyPay(name: string): number {
    return this.socialSecurityMonthlyPay.get(name) || 0;
  }

  public getPensionMonthlyPay(name: string): number {
    return this.pensionMonthlyPay.get(name) || 0;
  }

  public getPensionFirstPaymentYear(name: string): number | null {
    return this.pensionFirstPaymentYear.get(name) || null;
  }

  public getSocialSecurityFirstPaymentYear(name: string): number | null {
    return this.socialSecurityFirstPaymentYear.get(name) || null;
  }

  public setSocialSecurityFirstPaymentYear(name: string, year: number): void {
    this.socialSecurityFirstPaymentYear.set(name, year);
  }

  /********************
   * Social Security Calculations
   *********************/

  private calculateAIME(socialSecurity: SocialSecurity) {
    const yearlyAmounts: { year: number; amount: number }[] = [];
    if (this.socialSecurityAnnualIncomes.has(socialSecurity.name)) {
      const annualIncomes = this.socialSecurityAnnualIncomes.get(socialSecurity.name);
      if (annualIncomes) {
        annualIncomes.forEach((amount, year) => {
          yearlyAmounts.push({ year, amount });
        });
      }
    }
    const indexedAnnualIncomes = this.getIndexedAnnualIncomes(socialSecurity.yearTurn60, yearlyAmounts);
    while (indexedAnnualIncomes.length < 35) {
      indexedAnnualIncomes.push(0);
    }
    const aime = indexedAnnualIncomes.reduce((sum, curr) => sum + curr, 0) / 35 / 12;
    this.log('aime-calculated', { name: socialSecurity.name, aime });
    return aime;
  }

  private getIndexedAnnualIncomes(yearTurn60: number, yearlyIncomes: { year: number; amount: number }[]) {
    const averageWageIndex = this.getAverageWageIndex(yearTurn60);
    const indexedAnnualIncomes: number[] = [];
    yearlyIncomes.forEach(({ year, amount }) => {
      if (year > yearTurn60) {
        // For years after the year the person turns 60, we use the raw income
        indexedAnnualIncomes.push(amount);
        this.log('indexed-earnings', { year, raw_earnings: amount, indexed_earnings: amount });
      } else {
        // For years before the year the person turns 60, we base the indexed income on the average wage index for the year the person turns 60
        const indexedEarnings = (amount * averageWageIndex[yearTurn60]) / averageWageIndex[year];
        indexedAnnualIncomes.push(indexedEarnings);
        this.log('indexed-earnings', { year, raw_earnings: amount, indexed_earnings: indexedEarnings });
      }
    });
    return indexedAnnualIncomes;
  }

  private getAverageWageIndex(yearTurn60: number) {
    // Load everything we have data for
    if (!cachedWageIndex) {
      cachedWageIndex = loadAverageWageIndex();
    }
    // In MC mode, clone the cache to avoid cross-simulation corruption from mutations below
    const averageWageIndex = this.mcRateGetter
      ? { ...cachedWageIndex }
      : cachedWageIndex;
    // Extrapolate the average indices until the year the person turns 60
    const highestYear = Math.max(...Object.keys(averageWageIndex).map((x) => parseInt(x)));
    const years = Object.keys(averageWageIndex)
      .map((x) => parseInt(x))
      .sort((a, b) => a - b);

    // Compute historical average increase as fallback for deterministic mode
    const increases: number[] = [];
    for (let i = 1; i < years.length; i++) {
      const year = years[i];
      const prevYear = years[i - 1];
      const increase = (averageWageIndex[year] - averageWageIndex[prevYear]) / averageWageIndex[prevYear];
      increases.push(increase);
    }
    const averageIncrease = increases.reduce((sum, val) => sum + val, 0) / increases.length;

    for (let year = highestYear + 1; year <= yearTurn60; year++) {
      // MC mode: use AWI_GROWTH draw (a ratio like 1.045 for 4.5% growth)
      if (this.mcRateGetter) {
        const ratio = this.mcRateGetter(MonteCarloSampleType.AWI_GROWTH, year);
        if (ratio !== null) {
          averageWageIndex[year] = averageWageIndex[year - 1] * ratio;
          continue;
        }
      }
      // Deterministic: use historical average increase
      averageWageIndex[year] = averageWageIndex[year - 1] * (1 + averageIncrease);
    }
    return averageWageIndex;
  }

  private getBendPoints(yearTurns62: number) {
    // Load the bend points we have data for
    if (!cachedBendPoints) {
      cachedBendPoints = loadBendPoints();
    }
    // In MC mode, clone the cache to avoid cross-simulation corruption from mutations below
    const bendPoints: Record<number, { first: number; second: number }> = this.mcRateGetter
      ? Object.fromEntries(Object.entries(cachedBendPoints).map(([k, v]) => [Number(k), { ...v }]))
      : cachedBendPoints;
    // Extrapolate the bend points until the year the person turns 62 using the average rate of increase of all the years we have data for
    const highestYear = Math.max(...Object.keys(bendPoints).map((x) => parseInt(x)));
    const years = Object.keys(bendPoints)
      .map((x) => parseInt(x))
      .sort((a, b) => a - b);
    const firstBendPointIncreases: number[] = [];
    const secondBendPointIncreases: number[] = [];
    for (let i = 1; i < years.length; i++) {
      const year = years[i];
      const prevYear = years[i - 1];
      const firstIncrease = (bendPoints[year].first - bendPoints[prevYear].first) / bendPoints[prevYear].first;
      const secondIncrease = (bendPoints[year].second - bendPoints[prevYear].second) / bendPoints[prevYear].second;
      firstBendPointIncreases.push(firstIncrease);
      secondBendPointIncreases.push(secondIncrease);
    }
    const firstBendPointAverageIncrease =
      firstBendPointIncreases.reduce((sum, val) => sum + val, 0) / firstBendPointIncreases.length;
    const secondBendPointAverageIncrease =
      secondBendPointIncreases.reduce((sum, val) => sum + val, 0) / secondBendPointIncreases.length;
    for (let year = highestYear + 1; year <= yearTurns62; year++) {
      // Bend points scale with AWI — use AWI_GROWTH MC draws when available, same as getAverageWageIndex
      let growthRate: number;
      if (this.mcRateGetter) {
        const ratio = this.mcRateGetter(MonteCarloSampleType.AWI_GROWTH, year);
        // AWI_GROWTH draw is a ratio like 1.045; convert to growth rate (0.045)
        growthRate = ratio !== null ? (ratio - 1) : firstBendPointAverageIncrease;
      } else {
        growthRate = firstBendPointAverageIncrease;
      }
      // Use same MC-derived growth for both bend points (they track AWI proportionally)
      const secondGrowthRate = this.mcRateGetter
        ? growthRate
        : secondBendPointAverageIncrease;
      bendPoints[year] = {
        first: bendPoints[year - 1].first * (1 + growthRate),
        second: bendPoints[year - 1].second * (1 + secondGrowthRate),
      };
    }
    return bendPoints;
  }

  private computePIA(yearTurns62: number, aime: number) {
    const bendPoints = this.getBendPoints(yearTurns62);
    const firstBendPoint = bendPoints[yearTurns62].first;
    const secondBendPoint = bendPoints[yearTurns62].second;
    const originalAime = aime;
    const firstAmount = Math.min(aime, firstBendPoint);
    aime -= firstAmount;
    const secondAmount = Math.min(aime, secondBendPoint);
    aime -= secondAmount;
    const pia = firstAmount * 0.9 + secondAmount * 0.32 + aime * 0.15;
    this.log('pia-computed', { name: 'ss', aime: originalAime, bend1: firstBendPoint, bend2: secondBendPoint, pia });
    return pia;
  }

  /**
   * Get the Full Retirement Age (FRA) based on birth year
   * FRA varies from 65 to 67 depending on when the person was born
   */
  private getFullRetirementAge(birthYear: number): number {
    if (birthYear <= 1937) return 65;
    if (birthYear <= 1942) {
      // Gradual increase from 65+2mo to 65+10mo
      return 65 + ((birthYear - 1937) * 2) / 12;
    }
    if (birthYear <= 1954) return 66;
    if (birthYear === 1955) return 66 + 2 / 12;
    if (birthYear === 1956) return 66 + 4 / 12;
    if (birthYear === 1957) return 66 + 6 / 12;
    if (birthYear === 1958) return 66 + 8 / 12;
    if (birthYear === 1959) return 66 + 10 / 12;
    return 67; // 1960 and later
  }

  /**
   * Calculate the reduction/credit factor based on collection age and birth year
   * - Before FRA: reduced by 5/9 of 1% per month for first 36 months, then 5/12 of 1% per month beyond
   * - After FRA: credit of 8% per year (2/3 of 1% per month) for delayed retirement credits (up to age 70)
   * - At FRA: 100%
   */
  private factorForCollectionAge(collectionAge: number, birthYear: number) {
    if (collectionAge < 62) {
      return 0;
    }

    const fra = this.getFullRetirementAge(birthYear);
    const fraYears = Math.floor(fra);
    const fraMonths = Math.round((fra - fraYears) * 12);
    this.log('fra-determined', { birth_year: birthYear, fra_years: fraYears, fra_months: fraMonths });
    const monthsFromFRA = Math.round((collectionAge - fra) * 12);

    if (monthsFromFRA === 0) {
      // Claiming at exactly FRA
      return 1.0;
    } else if (monthsFromFRA < 0) {
      // Early claiming (before FRA)
      const monthsEarly = Math.abs(monthsFromFRA);
      let reduction = 0;

      if (monthsEarly <= 36) {
        // First 36 months: 5/9 of 1% per month
        reduction = monthsEarly * (5 / 9 / 100);
      } else {
        // First 36 months at 5/9 of 1% per month
        reduction = 36 * (5 / 9 / 100);
        // Additional months at 5/12 of 1% per month
        const additionalMonths = monthsEarly - 36;
        reduction += additionalMonths * (5 / 12 / 100);
      }

      return 1.0 - reduction;
    } else {
      // Delayed claiming (after FRA)
      const monthsDelayed = Math.min(monthsFromFRA, (70 - fra) * 12); // Cap at age 70
      // Delayed retirement credit: 2/3 of 1% per month (8% per year)
      const credit = monthsDelayed * (2 / 3 / 100);
      return 1.0 + credit;
    }
  }

  /**************
   * Pension Calculations
   ***************/
  private getHighestCompensationAverage(pension: Pension) {
    // Get the income gained each year
    const yearlyAmounts: { year: number; amount: number }[] = [];
    if (this.pensionAnnualIncomes.has(pension.name)) {
      const annualIncomes = this.pensionAnnualIncomes.get(pension.name);
      if (annualIncomes) {
        annualIncomes.forEach((amount, year) => {
          // Only include income from years the person actually worked (before workEndDate if set)
          if (!pension.workEndDate || year < pension.workEndDate.getUTCFullYear()) {
            yearlyAmounts.push({ year, amount });
          }
        });
      }
    }

    // Use the configurable years to average
    const yearsToAverage = pension.highestCompensationConsecutiveYearsToAverage;
    const averageConsecutiveYearPays: number[] = [];
    for (let i = 0; i <= yearlyAmounts.length - yearsToAverage; i++) {
      const consecutiveYearSum = yearlyAmounts.slice(i, i + yearsToAverage).reduce((sum, curr) => sum + curr.amount, 0);
      averageConsecutiveYearPays.push(consecutiveYearSum / yearsToAverage);
    }

    // Return highest average, or 0 if no valid averages
    return averageConsecutiveYearPays.length > 0 ? Math.max(...averageConsecutiveYearPays) : 0;
  }

  /**************
   * RMD Calculations
   ***************/
  private loadRMDTable() {
    if (!cachedRMDTable) {
      const rmdTable = load<RMDTableType>('rmd.json');
      cachedRMDTable = Object.fromEntries(Object.entries(rmdTable).map(([k, v]) => [parseInt(k), v]));
    }
    return cachedRMDTable;
  }

  public rmd(balance: number, age: number) {
    if (age in this.rmdTable) {
      return balance / this.rmdTable[age];
    }
    return 0;
  }

  /**
   * Get Social Security wage base cap for a given year.
   * In MC mode, uses SS_WAGE_BASE_CHANGE draws for future years.
   */
  public getWageBaseCapForYear(year: number): number {
    return getWageBaseCap(year, this.mcRateGetter);
  }
}
