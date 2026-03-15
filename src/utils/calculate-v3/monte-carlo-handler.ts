import * as fs from 'fs/promises';
import * as path from 'path';
import {
  MonteCarloSampleType,
  HistoricRates,
  ProxyDefinition,
  PortfolioComposition,
  PortfolioMakeupOverTime,
} from './types';
import { formatDate } from '../date/date';

/**
 * Mulberry32 seeded PRNG — fast and deterministic
 * Returns a function that produces values in [0, 1)
 */
function createSeededRandom(seed: number): () => number {
  return function() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MonteCarloHandler {
  private historicRates: HistoricRates | null = null;
  private portfolioMakeup: PortfolioMakeupOverTime | null = null;
  private segmentSamples: Record<string, Record<MonteCarloSampleType, number>>;
  private yearKeyedData: Record<string, Record<string, number>> = {};
  private availableYears: number[] = [];
  private random: () => number = Math.random;

  public static async getInstance(startDate: Date, endDate: Date, seed?: number): Promise<MonteCarloHandler> {
    const handler = new MonteCarloHandler();
    if (seed !== undefined) {
      handler.random = createSeededRandom(seed);
    }
    await handler.initialize();
    handler.generateSegmentSamples(startDate, endDate);
    return handler;
  }

  private async initialize(): Promise<void> {
    try {
      const dataDir = path.join(__dirname, '..', '..', '..', 'data');

      const historicRatesPath = path.join(dataDir, 'historicRates.json');
      const historicRatesContent = await fs.readFile(historicRatesPath, 'utf-8');
      this.historicRates = JSON.parse(historicRatesContent);

      // Extract yearKeyed data for correlated sampling
      this.yearKeyedData = this.historicRates.yearKeyed || {};
      this.availableYears = Object.keys(this.yearKeyedData)
        .map(Number)
        .sort((a, b) => a - b);

      const portfolioMakeupPath = path.join(dataDir, 'portfolioMakeupOverTime.json');
      const portfolioMakeupContent = await fs.readFile(portfolioMakeupPath, 'utf-8');
      this.portfolioMakeup = JSON.parse(portfolioMakeupContent);
    } catch (error) {
      throw new Error(`Failed to initialize MonteCarloHandler: ${error}`);
    }
  }

  private generateSegmentSamples(startDate: Date, endDate: Date): void {
    // console.log(
    //   `Generating segment samples for ${formatDate(startDate)} (${startDate.getFullYear()}-${startDate.getMonth() + 1}) to ${formatDate(endDate)} (${endDate.getFullYear()}-${endDate.getMonth() + 1})`,
    // );
    const samples: Record<string, Record<MonteCarloSampleType, number>> = {};
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();

    for (let year = startYear; year <= endYear; year++) {
      // Draw one random historical year for correlated sampling across all types
      const randomYear = this.availableYears[Math.floor(this.random() * this.availableYears.length)];
      const yearData = this.yearKeyedData[String(randomYear)] || {};

      // Build samples for this year from the drawn historical year
      const yearSamples: Record<MonteCarloSampleType, number> = {};

      // HYSA - correlated draw from same historical year
      yearSamples[MonteCarloSampleType.HYSA] = yearData.highYield !== undefined
        ? yearData.highYield / 100
        : this.drawRandomSample(this.historicRates?.savings?.highYield) / 100;

      // LYSA - correlated draw from same historical year
      yearSamples[MonteCarloSampleType.LYSA] = yearData.lowYield !== undefined
        ? yearData.lowYield / 100
        : this.drawRandomSample(this.historicRates?.savings?.lowYield) / 100;

      // Inflation - correlated draw from same historical year
      yearSamples[MonteCarloSampleType.INFLATION] = yearData.inflation !== undefined
        ? yearData.inflation / 100
        : this.drawRandomSample(this.historicRates?.inflation) / 100;

      // Raise - correlated draw from same historical year
      yearSamples[MonteCarloSampleType.RAISE] = yearData.raise !== undefined
        ? yearData.raise / 100
        : this.drawRandomSample(this.historicRates?.raise) / 100;

      // 401k Limit Increase - correlated draw from same historical year
      yearSamples[MonteCarloSampleType.LIMIT_INCREASE_401K] = yearData.limitIncrease401k !== undefined
        ? yearData.limitIncrease401k / 100
        : this.drawRandomSample(this.historicRates?.limitIncrease401k) / 100;

      // SS COLA - correlated draw from same historical year
      yearSamples[MonteCarloSampleType.SS_COLA] = yearData.ssCola !== undefined
        ? yearData.ssCola / 100
        : this.drawRandomSample(this.historicRates?.ssCola) / 100;

      // Change ratios — these are multipliers (e.g., 1.098 for 9.8% increase), NOT percentages
      // So do NOT divide by 100
      yearSamples[MonteCarloSampleType.SS_WAGE_BASE_CHANGE] = yearData.ssWageBaseRatio ?? 1.0;
      yearSamples[MonteCarloSampleType.K401_LIMIT_CHANGE] = yearData.k401Ratio ?? 1.0;
      yearSamples[MonteCarloSampleType.IRA_LIMIT_CHANGE] = yearData.iraRatio ?? 1.0;
      yearSamples[MonteCarloSampleType.HSA_LIMIT_CHANGE] = yearData.hsaRatio ?? 1.0;

      // Portfolio - use the SAME drawn year for stock/bond/cash
      const composition = this.getPortfolioComposition(new Date(year, 6, 1)); // mid-year
      const stockReturn = yearData.stock !== undefined
        ? yearData.stock / 100
        : this.drawRandomSample(this.historicRates?.investment?.stock) / 100;
      const bondReturn = yearData.bond !== undefined
        ? yearData.bond / 100
        : this.drawRandomSample(this.historicRates?.investment?.bond) / 100;
      const cashReturn = yearData.highYield !== undefined
        ? yearData.highYield / 100
        : this.drawRandomSample(this.historicRates?.savings?.highYield) / 100;

      yearSamples[MonteCarloSampleType.PORTFOLIO] =
        stockReturn * (composition.stock || 0) +
        bondReturn * (composition.bond || 0) +
        cashReturn * (composition.cash || 0) +
        this.calculateProxyReturn(this.historicRates?.investment?.preferred, stockReturn, bondReturn) * (composition.preferred || 0) +
        this.calculateProxyReturn(this.historicRates?.investment?.convertible, stockReturn, bondReturn) * (composition.convertible || 0) +
        this.calculateProxyReturn(this.historicRates?.investment?.other, stockReturn, bondReturn) * (composition.other || 0);

      // Reuse same samples for ALL 12 months of this year
      for (let month = 0; month < 12; month++) {
        const segmentKey = `${year}-${month + 1}`;
        samples[segmentKey] = { ...yearSamples } as Record<MonteCarloSampleType, number>;
      }
    }

    this.segmentSamples = samples;
    // this.saveSegmentSamples(startDate, endDate);
  }

  // private saveSegmentSamples(startDate: Date, endDate: Date): void {
  //   const dataDir = path.join(__dirname, '..', '..', '..', 'logs');
  //   const segmentSamplesPath = path.join(
  //     dataDir,
  //     `segmentSamples-${formatDate(startDate)}-${formatDate(endDate)}.json`,
  //   );
  //   fs.writeFile(segmentSamplesPath, JSON.stringify(this.segmentSamples, null, 2));
  // }

  public getSample(type: MonteCarloSampleType, date: Date): number {
    const segmentKey = `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
    const segmentSamples = this.segmentSamples[segmentKey];
    if (!segmentSamples) {
      throw new Error(`No samples found for segment ${segmentKey} on ${formatDate(date)}`);
    }
    return segmentSamples[type];
  }

  /**
   * Extract inflation rates per year from stored segment samples
   * Returns a map of year → inflation rate (as decimal, e.g., 0.03 for 3%)
   */
  public getInflationByYear(): Record<number, number> {
    const result: Record<number, number> = {};

    // Segment keys are formatted as "YYYY-M" where M is month (1-12)
    // Since we sample annually and replicate for all 12 months, we just need the first month of each year
    for (const [key, samples] of Object.entries(this.segmentSamples)) {
      const [yearStr, monthStr] = key.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);

      // Only capture once per year (month 1)
      if (month === 1 && !result[year]) {
        result[year] = samples[MonteCarloSampleType.INFLATION];
      }
    }

    return result;
  }

  private calculateProxyReturn(proxyDef: ProxyDefinition | undefined, stockReturn: number, bondReturn: number): number {
    if (!proxyDef) {
      return 0;
    }

    let proxyReturn = 0;
    for (const [assetType, weight] of Object.entries(proxyDef.proxy)) {
      switch (assetType) {
        case 'stock':
          proxyReturn += stockReturn * weight;
          break;
        case 'bond':
          proxyReturn += bondReturn * weight;
          break;
        case 'cash':
          const cashReturn = this.drawRandomSample(this.historicRates?.savings?.highYield) / 100;
          proxyReturn += cashReturn * weight;
          break;
      }
    }
    return proxyReturn;
  }

  private getPortfolioComposition(date: Date): PortfolioComposition {
    if (!this.portfolioMakeup) {
      throw new Error('Portfolio makeup data not loaded');
    }

    const year = date.getUTCFullYear();
    const yearStr = year.toString();

    if (this.portfolioMakeup[yearStr]) {
      return this.portfolioMakeup[yearStr];
    }

    const years = Object.keys(this.portfolioMakeup)
      .map(Number)
      .sort((a, b) => a - b);

    if (year < years[0]) {
      return this.portfolioMakeup[years[0].toString()];
    }

    if (year > years[years.length - 1]) {
      return this.portfolioMakeup[years[years.length - 1].toString()];
    }

    let prevYear = years[0];
    for (const y of years) {
      if (y > year) {
        break;
      }
      prevYear = y;
    }

    return this.portfolioMakeup[prevYear.toString()];
  }


  private drawRandomSample(data: number[] | undefined): number {
    if (!data || data.length === 0) {
      return 0;
    }

    const randomIndex = Math.floor(this.random() * data.length);
    return data[randomIndex];
  }
}
