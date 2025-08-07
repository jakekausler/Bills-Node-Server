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

export class MonteCarloHandler {
  private historicRates: HistoricRates | null = null;
  private portfolioMakeup: PortfolioMakeupOverTime | null = null;
  private segmentSamples: Record<string, Record<MonteCarloSampleType, number>>;

  public static async getInstance(startDate: Date, endDate: Date): Promise<MonteCarloHandler> {
    const handler = new MonteCarloHandler();
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
      for (let month = 0; month < 12; month++) {
        const segmentKey = `${year}-${month + 1}`;
        // console.log(`Generating segment samples for ${segmentKey} ${year}-${month + 1}`);
        const segmentSamples: Record<MonteCarloSampleType, number> = {
          [MonteCarloSampleType.HYSA]: this.drawSample(MonteCarloSampleType.HYSA, new Date(year, month, 1)),
          [MonteCarloSampleType.LYSA]: this.drawSample(MonteCarloSampleType.LYSA, new Date(year, month, 1)),
          [MonteCarloSampleType.PORTFOLIO]: this.drawSample(MonteCarloSampleType.PORTFOLIO, new Date(year, month, 1)),
          [MonteCarloSampleType.INFLATION]: this.drawSample(MonteCarloSampleType.INFLATION, new Date(year, month, 1)),
          [MonteCarloSampleType.RAISE]: this.drawSample(MonteCarloSampleType.RAISE, new Date(year, month, 1)),
          [MonteCarloSampleType.LIMIT_INCREASE_401K]: this.drawSample(
            MonteCarloSampleType.LIMIT_INCREASE_401K,
            new Date(year, month, 1),
          ),
        };
        samples[segmentKey] = segmentSamples;
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

  private drawSample(type: MonteCarloSampleType, date: Date): number {
    if (!this.historicRates || !this.portfolioMakeup) {
      throw new Error('MonteCarloHandler not initialized');
    }

    let sample: number;

    switch (type) {
      case MonteCarloSampleType.HYSA:
        sample = this.drawRandomSample(this.historicRates.savings.highYield);
        break;
      case MonteCarloSampleType.LYSA:
        sample = this.drawRandomSample(this.historicRates.savings.lowYield);
        break;
      case MonteCarloSampleType.PORTFOLIO:
        const composition = this.getPortfolioComposition(date);
        sample = this.calculatePortfolioSample(composition);
        break;
      case MonteCarloSampleType.INFLATION:
        sample = this.drawRandomSample(this.historicRates.inflation);
        break;
      case MonteCarloSampleType.RAISE:
        sample = this.drawRandomSample(this.historicRates.raise);
        break;
      case MonteCarloSampleType.LIMIT_INCREASE_401K:
        sample = this.drawRandomSample(this.historicRates.limitIncrease401k);
        break;
      default:
        throw new Error(`Unknown Monte Carlo sample type: ${type}`);
    }

    // Convert from percentage to decimal (e.g., 5.5 -> 0.055)
    const decimalSample = sample / 100;

    return decimalSample;
  }

  private getPortfolioComposition(date: Date): PortfolioComposition {
    if (!this.portfolioMakeup) {
      throw new Error('Portfolio makeup data not loaded');
    }

    const year = date.getFullYear();
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

  private calculatePortfolioSample(composition: PortfolioComposition): number {
    if (!this.historicRates) {
      throw new Error('Historic rates not loaded');
    }

    let totalReturn = 0;
    const assetReturns: Record<string, { return: number; weight: number; contribution: number }> = {};

    if (composition.cash > 0 && this.historicRates.investment.cash) {
      const cashReturn = this.drawRandomSample(this.historicRates.investment.cash);
      const contribution = cashReturn * composition.cash;
      totalReturn += contribution;
      assetReturns.cash = { return: cashReturn, weight: composition.cash, contribution };
    }

    if (composition.stock > 0 && this.historicRates.investment.stock) {
      const stockReturn = this.drawRandomSample(this.historicRates.investment.stock);
      const contribution = stockReturn * composition.stock;
      totalReturn += contribution;
      assetReturns.stock = { return: stockReturn, weight: composition.stock, contribution };
    }

    if (composition.bond > 0 && this.historicRates.investment.bond) {
      const bondReturn = this.drawRandomSample(this.historicRates.investment.bond);
      const contribution = bondReturn * composition.bond;
      totalReturn += contribution;
      assetReturns.bond = { return: bondReturn, weight: composition.bond, contribution };
    }

    if (composition.preferred > 0 && this.historicRates.investment.preferred) {
      const preferredReturn = this.resolveProxyAsset(this.historicRates.investment.preferred);
      const contribution = preferredReturn * composition.preferred;
      totalReturn += contribution;
      assetReturns.preferred = { return: preferredReturn, weight: composition.preferred, contribution };
    }

    if (composition.convertible > 0 && this.historicRates.investment.convertible) {
      const convertibleReturn = this.resolveProxyAsset(this.historicRates.investment.convertible);
      const contribution = convertibleReturn * composition.convertible;
      totalReturn += contribution;
      assetReturns.convertible = { return: convertibleReturn, weight: composition.convertible, contribution };
    }

    if (composition.other > 0 && this.historicRates.investment.other) {
      const otherReturn = this.resolveProxyAsset(this.historicRates.investment.other);
      const contribution = otherReturn * composition.other;
      totalReturn += contribution;
      assetReturns.other = { return: otherReturn, weight: composition.other, contribution };
    }

    return totalReturn;
  }

  private resolveProxyAsset(proxyDef: ProxyDefinition): number {
    if (!this.historicRates) {
      throw new Error('Historic rates not loaded');
    }

    let proxyReturn = 0;

    for (const [assetType, weight] of Object.entries(proxyDef.proxy)) {
      let assetReturn = 0;

      switch (assetType) {
        case 'stock':
          if (this.historicRates.investment.stock) {
            assetReturn = this.drawRandomSample(this.historicRates.investment.stock);
          }
          break;
        case 'bond':
          if (this.historicRates.investment.bond) {
            assetReturn = this.drawRandomSample(this.historicRates.investment.bond);
          }
          break;
        case 'cash':
          if (this.historicRates.investment.cash) {
            assetReturn = this.drawRandomSample(this.historicRates.investment.cash);
          }
          break;
        case 'preferred':
          if (this.historicRates.investment.preferred) {
            assetReturn = this.resolveProxyAsset(this.historicRates.investment.preferred);
          }
          break;
        case 'convertible':
          if (this.historicRates.investment.convertible) {
            assetReturn = this.resolveProxyAsset(this.historicRates.investment.convertible);
          }
          break;
        case 'other':
          if (this.historicRates.investment.other) {
            assetReturn = this.resolveProxyAsset(this.historicRates.investment.other);
          }
          break;
      }

      proxyReturn += assetReturn * weight;
    }

    return proxyReturn;
  }

  private drawRandomSample(data: number[] | undefined): number {
    if (!data || data.length === 0) {
      return 0;
    }

    const randomIndex = Math.floor(Math.random() * data.length);
    return data[randomIndex];
  }
}
