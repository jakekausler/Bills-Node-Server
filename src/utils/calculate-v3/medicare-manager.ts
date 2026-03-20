import { HistoricRates, MCRateGetter, MonteCarloSampleType } from './types';
import { load } from '../io/io';
import type { DebugLogger } from './debug-logger';

/**
 * IRMAA (Income-Related Monthly Adjustment Amount) bracket definition
 */
interface IRMABracket {
  tier: number;
  singleMin: number;
  singleMax: number;
  marriedMin: number;
  marriedMax: number;
  partBPremium: number;
  partDSurcharge: number;
}

// Module-level caches
let cachedHistoricRates: HistoricRates | null = null;
let cachedIRMABrackets: Record<string, IRMABracket[]> | null = null;

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
 * Load IRMAA brackets from data file (cached at module level)
 */
function getIRMABrackets(): Record<string, IRMABracket[]> {
  if (!cachedIRMABrackets) {
    cachedIRMABrackets = load<Record<string, IRMABracket[]>>('irmaaBrackets.json');
  }
  return cachedIRMABrackets;
}

/**
 * Medicare manager for handling IRMAA surcharges, Part B/D premiums,
 * and hospital admission generation with Poisson distribution.
 */
/**
 * Clears module-level caches for Medicare data.
 * Used by the cache-clear endpoint to force re-reads from disk.
 */
export function clearMedicareCache() {
  cachedHistoricRates = null;
  cachedIRMABrackets = null;
}

export class MedicareManager {
  // Hospital admission rates (Poisson lambda) by age
  // Represents expected number of hospital admissions per year
  private readonly HOSPITAL_ADMISSION_RATES: Record<number, number> = {
    65: 0.15,
    70: 0.2,
    75: 0.25,
    80: 0.35,
    85: 0.45,
    90: 0.5,
  };
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private mcRateGetter: MCRateGetter | null = null;

  constructor(debugLogger?: DebugLogger | null, simNumber: number = 0) {
    // Constructor is minimal; historicRates and IRMAA brackets loaded on-demand
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  /** Set the MC rate getter for sampling healthcare inflation in MC mode */
  setMCRateGetter(getter: MCRateGetter | null): void {
    this.mcRateGetter = getter;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'medicare', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /** Set the current simulation date for debug log entries */
  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  /**
   * Get a Medicare value (premium, deductible) using historical data and change ratios.
   * @private
   */
  private getMedicareValue(
    dataField: 'partBPremium' | 'partDBasePremium' | 'partADeductible' | 'partBDeductible' | 'medigapPlanG',
    year: number,
    defaultValue: number,
  ): number {
    const rates = getHistoricRates();
    const data = rates.medicare?.[dataField] || {};
    const changeRatios = rates.changeRatios?.[dataField] || {};

    // Find the most recent known year
    const knownYears = Object.keys(data)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => b - a);

    if (knownYears.length === 0) {
      return defaultValue;
    }

    const latestYear = knownYears[0];
    const latestValue = data[latestYear.toString()];

    if (year <= latestYear) {
      return data[year.toString()] || latestValue;
    }

    // Project forward using change ratios if available, otherwise use healthcare CPI
    let projectedValue = latestValue;
    for (let y = latestYear + 1; y <= year; y++) {
      const ratio = changeRatios[y.toString()];
      if (ratio) {
        projectedValue *= ratio;
        this.log('change-ratio-used', { year: y, ratio, value: projectedValue });
      } else {
        // Fall back to healthcare CPI
        const inflationRate = this.getHealthcareInflationRate(y);
        projectedValue *= 1 + inflationRate;
        this.log('fallback-inflation', { year: y, inflation_rate: inflationRate, value: projectedValue });
      }
    }

    const result = Math.round(projectedValue * 100) / 100;
    this.log('value-projected', { field: dataField, year, latest_year: latestYear, projected_value: result });
    return result;
  }

  /**
   * Get IRMAA surcharge for Part B and Part D based on MAGI, filing status, and year.
   * Returns monthly surcharge amounts (premium above base).
   */
  getIRMAASurcharge(
    magi: number,
    filingStatus: 'mfj' | 'single',
    year: number = 2024,
  ): { partBSurcharge: number; partDSurcharge: number } {
    const irmaaData = getIRMABrackets();

    // Find the appropriate year (use exact year or most recent available)
    let yearStr = year.toString();
    if (!(yearStr in irmaaData)) {
      // Find most recent year <= requested year
      const availableYears = Object.keys(irmaaData)
        .map(y => parseInt(y, 10))
        .sort((a, b) => b - a);
      for (const availableYear of availableYears) {
        if (availableYear <= year) {
          yearStr = availableYear.toString();
          break;
        }
      }
      // If no year found, use the most recent available
      if (!(yearStr in irmaaData)) {
        yearStr = availableYears[0].toString();
      }
    }

    let yearBrackets = irmaaData[yearStr] || [];
    const baseYearNum = parseInt(yearStr, 10);

    // Inflate IRMAA thresholds for future years beyond available data (MC mode only)
    // In deterministic mode, use the raw bracket data as-is (unchanged behavior)
    if (this.mcRateGetter && year > baseYearNum && yearBrackets.length > 0) {
      yearBrackets = yearBrackets.map(bracket => {
        let inflationMultiplier = 1;
        for (let y = baseYearNum + 1; y <= year; y++) {
          const mcRate = this.mcRateGetter!(MonteCarloSampleType.INFLATION, y);
          const rate = mcRate !== null ? mcRate : 0.03;
          inflationMultiplier *= (1 + rate);
        }
        return {
          ...bracket,
          singleMin: Math.round(bracket.singleMin * inflationMultiplier),
          singleMax: Math.round(bracket.singleMax * inflationMultiplier),
          marriedMin: Math.round(bracket.marriedMin * inflationMultiplier),
          marriedMax: Math.round(bracket.marriedMax * inflationMultiplier),
        };
      });
    }

    const minIncome = filingStatus === 'mfj' ? 'marriedMin' : 'singleMin';
    const maxIncome = filingStatus === 'mfj' ? 'marriedMax' : 'singleMax';

    // Find the bracket that matches the income
    let matchedBracket: IRMABracket | null = null;
    for (const bracket of yearBrackets) {
      if (magi >= bracket[minIncome] && magi <= bracket[maxIncome]) {
        matchedBracket = bracket;
        break;
      }
    }

    // If income exceeds all brackets, return the highest
    if (!matchedBracket) {
      matchedBracket = yearBrackets[yearBrackets.length - 1];
    }

    if (!matchedBracket) {
      return { partBSurcharge: 0, partDSurcharge: 0 };
    }

    this.log('irmaa-bracket-matched', {
      magi,
      filing_status: filingStatus,
      year,
      tier: matchedBracket.tier,
      part_b_surcharge: matchedBracket.partBPremium,
      part_d_surcharge: matchedBracket.partDSurcharge,
    });

    // Get base bracket (tier 0) to calculate surcharge
    const baseBracket = yearBrackets[0];
    const basePremium = baseBracket.partBPremium || 0;
    const basePartDSurcharge = baseBracket.partDSurcharge || 0;

    return {
      partBSurcharge: Math.max(0, (matchedBracket.partBPremium || 0) - basePremium),
      partDSurcharge: (matchedBracket.partDSurcharge || 0) - basePartDSurcharge,
    };
  }

  /**
   * Get Part B premium for a given year (monthly amount in dollars).
   * Uses historical data with change ratios for future projection.
   */
  getPartBPremium(year: number): number {
    const premium = this.getMedicareValue('partBPremium', year, 174.7);
    this.log('part-b-premium', { year, premium });
    return premium;
  }

  /**
   * Get Part D base premium for a given year (monthly amount in dollars).
   * Uses historical data with change ratios for future projection.
   */
  getPartDBasePremium(year: number): number {
    const premium = this.getMedicareValue('partDBasePremium', year, 36);
    this.log('part-d-premium', { year, premium });
    return premium;
  }

  /**
   * Get Part A deductible (hospital inpatient deductible, per admission).
   * Uses historical data with change ratios for future projection.
   */
  getPartADeductible(year: number): number {
    return Math.round(this.getMedicareValue('partADeductible', year, 1600));
  }

  /**
   * Get Part B deductible (annual deductible for Part B services).
   * Uses historical data with change ratios for future projection.
   */
  getPartBDeductible(year: number): number {
    return Math.round(this.getMedicareValue('partBDeductible', year, 240));
  }

  /**
   * Calculate total monthly Medicare cost including Part B, Part D, Medigap,
   * and IRMAA surcharge based on prior-year MAGI.
   */
  getMonthlyMedicareCost(
    age: number,
    magi: number,
    filingStatus: 'mfj' | 'single',
    year: number,
  ): number {
    // If not yet 65, return 0
    if (age < 65) {
      return 0;
    }

    const partBPremium = this.getPartBPremium(year);
    const partDBasePremium = this.getPartDBasePremium(year);
    const medigapPremium = this.getMedigapMonthlyPremium(year);

    // Get IRMAA surcharge based on MAGI and year
    const { partBSurcharge, partDSurcharge } = this.getIRMAASurcharge(magi, filingStatus, year);

    const totalMonthly = partBPremium + partBSurcharge + partDBasePremium + partDSurcharge + medigapPremium;

    return Math.round(totalMonthly * 100) / 100;
  }

  /**
   * Get Medigap (supplement) monthly premium for a given year.
   * Uses historical data with change ratios for future projection.
   */
  /**
   * Get Medigap (supplement) monthly premium for a given year.
   * Uses historical data with change ratios for future projection.
   */
  private getMedigapMonthlyPremium(year: number): number {
    return this.getMedicareValue('medigapPlanG', year, 200);
  }

  /**
   * Get healthcare inflation rate for a given year.
   * In MC mode, uses the healthcare CPI draw. In deterministic, defaults to 3%.
   */
  private getHealthcareInflationRate(year: number): number {
    if (this.mcRateGetter) {
      const mcRate = this.mcRateGetter(MonteCarloSampleType.HEALTHCARE_INFLATION, year);
      if (mcRate !== null) return mcRate;
    }
    // Default 3% healthcare inflation
    return 0.03;
  }

  /**
   * Generate Poisson-distributed hospital admissions for a given age and year.
   * Used in Monte Carlo simulations. In deterministic mode, return the expected value.
   */
  generateHospitalAdmissions(age: number, year: number, random?: () => number): number {
    // Get lambda (expected admissions per year) based on age
    let lambda = 0.15; // Default

    // Find closest age bracket
    const ageKeys = Object.keys(this.HOSPITAL_ADMISSION_RATES)
      .map((k) => parseInt(k, 10))
      .sort((a, b) => a - b);

    for (let i = ageKeys.length - 1; i >= 0; i--) {
      if (age >= ageKeys[i]) {
        lambda = this.HOSPITAL_ADMISSION_RATES[ageKeys[i]];
        break;
      }
    }

    // If no random function provided, return expected value
    if (!random) {
      return Math.round(lambda);
    }

    // Generate Poisson random variable using Knuth's algorithm
    return this.poissonRandom(lambda, random);
  }

  /**
   * Poisson random variable generator (Knuth's algorithm).
   * Generates a random count from a Poisson distribution with parameter lambda.
   */
  private poissonRandom(lambda: number, random: () => number): number {
    let count = 0;
    let p = Math.exp(-lambda);
    let s = p;
    const u = random();

    while (u > s) {
      count++;
      p *= lambda / count;
      s += p;
    }

    return count;
  }
}
