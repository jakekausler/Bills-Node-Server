import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { formatDate } from '../date/date';
import { loadAverageWageIndex } from '../io/averageWageIndex';
import { loadBendPoints } from '../io/bendPoints';

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

  constructor(socialSecurities: SocialSecurity[], pensions: Pension[]) {
    this.socialSecurities = socialSecurities;
    this.pensions = pensions;
    this.initializeSocialSecurity();
    this.initializePension();
  }

  private initializeSocialSecurity() {
    this.socialSecurities.forEach((socialSecurity) => {
      // Fiil the annual incomes for each year from the minimum year in the data to the docial security start date year
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
    this.socialSecurityAnnualIncomes.get(name)?.set(year, income + priorBalance);
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
    const factorForCollectionAge = this.factorForCollectionAge(socialSecurity.collectionAge);
    const monthlyPay = pia * factorForCollectionAge;
    this.socialSecurityMonthlyPay.set(socialSecurity.name, monthlyPay);
  }

  public calculatePensionMonthlyPay(pension: Pension): void {
    const highestCompensationAverage = this.getHighestCompensationAverage(pension);
    const monthlyPay =
      (highestCompensationAverage * pension.accrualFactor * pension.yearsWorked * pension.reductionFactor) / 12;
    this.pensionMonthlyPay.set(pension.name, monthlyPay);
  }

  public getSocialSecurityMonthlyPay(name: string): number {
    return this.socialSecurityMonthlyPay.get(name) || 0;
  }

  public getPensionMonthlyPay(name: string): number {
    return this.pensionMonthlyPay.get(name) || 0;
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
    return indexedAnnualIncomes.reduce((sum, curr) => sum + curr, 0) / 35 / 12;
  }

  private getIndexedAnnualIncomes(yearTurn60: number, yearlyIncomes: { year: number; amount: number }[]) {
    const averageWageIndex = this.getAverageWageIndex(yearTurn60);
    const indexedAnnualIncomes: number[] = [];
    yearlyIncomes.forEach(({ year, amount }) => {
      if (year > yearTurn60) {
        // For years after the year the person turns 60, we use the raw income
        indexedAnnualIncomes.push(amount);
      } else {
        // For years before the year the person turns 60, we base the indexed income on the average wage index for the year the person turns 60
        const indexedEarnings = (amount * averageWageIndex[yearTurn60]) / averageWageIndex[year];
        indexedAnnualIncomes.push(indexedEarnings);
      }
    });
    return indexedAnnualIncomes;
  }

  private getAverageWageIndex(yearTurn60: number) {
    // Load everything we have data for
    const averageWageIndex = loadAverageWageIndex();
    // Extrapolate the average indices until the year the person turns 60 using the average rate of increase of all the years we have data for
    const highestYear = Math.max(...Object.keys(averageWageIndex).map((x) => parseInt(x)));
    const years = Object.keys(averageWageIndex)
      .map((x) => parseInt(x))
      .sort((a, b) => a - b);
    const increases: number[] = [];
    for (let i = 1; i < years.length; i++) {
      const year = years[i];
      const prevYear = years[i - 1];
      const increase = (averageWageIndex[year] - averageWageIndex[prevYear]) / averageWageIndex[prevYear];
      increases.push(increase);
    }
    const averageIncrease = increases.reduce((sum, val) => sum + val, 0) / increases.length;
    for (let year = highestYear + 1; year <= yearTurn60; year++) {
      averageWageIndex[year] = averageWageIndex[year - 1] * (1 + averageIncrease);
    }
    return averageWageIndex;
  }

  private getBendPoints(yearTurns62: number) {
    // Load the bend points we have data for
    const bendPoints = loadBendPoints();
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
      bendPoints[year] = {
        first: bendPoints[year - 1].first * (1 + firstBendPointAverageIncrease),
        second: bendPoints[year - 1].second * (1 + secondBendPointAverageIncrease),
      };
    }
    return bendPoints;
  }

  private computePIA(yearTurns62: number, aime: number) {
    const bendPoints = this.getBendPoints(yearTurns62);
    const firstBendPoint = bendPoints[yearTurns62].first;
    const secondBendPoint = bendPoints[yearTurns62].second;
    const firstAmount = Math.min(aime, firstBendPoint);
    aime -= firstAmount;
    const secondAmount = Math.min(aime, secondBendPoint);
    aime -= secondAmount;
    return firstAmount * 0.9 + secondAmount * 0.32 + aime * 0.15;
  }

  private factorForCollectionAge(collectionAge: number) {
    if (collectionAge < 62) {
      return 0;
    }
    if (collectionAge === 62) {
      return 0.7;
    }
    if (collectionAge === 63) {
      return 0.75;
    }
    if (collectionAge === 64) {
      return 0.8;
    }
    if (collectionAge === 65) {
      return 0.8666666667;
    }
    if (collectionAge === 66) {
      return 0.9333333333;
    }
    if (collectionAge === 67) {
      return 1;
    }
    if (collectionAge === 68) {
      return 1.08;
    }
    if (collectionAge === 69) {
      return 1.16;
    }
    return 1.24;
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
          yearlyAmounts.push({ year, amount });
        });
      }
    }

    // Calculate 4-year averages
    const averageConsecutiveYearPays: number[] = [];
    for (let i = 0; i <= yearlyAmounts.length - 4; i++) {
      const fourYearSum = yearlyAmounts.slice(i, i + 4).reduce((sum, curr) => sum + curr.amount, 0);
      averageConsecutiveYearPays.push(fourYearSum / 4);
    }

    // Return highest average, or 0 if no valid averages
    return averageConsecutiveYearPays.length > 0 ? Math.max(...averageConsecutiveYearPays) : 0;
  }
}
