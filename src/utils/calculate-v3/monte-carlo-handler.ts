import * as fs from 'fs/promises';
import * as path from 'path';
import {
  MonteCarloSampleType,
  HistoricRates,
  ProxyDefinition,
  PortfolioComposition,
  PortfolioMakeupOverTime,
  SampleRecord,
} from './types';

export class MonteCarloHandler {
  private static instance: MonteCarloHandler | null = null;
  private static initializationPromise: Promise<MonteCarloHandler> | null = null;
  private historicRates: HistoricRates | null = null;
  private portfolioMakeup: PortfolioMakeupOverTime | null = null;
  private sampleHistory: Map<string, SampleRecord[]>;
  private currentSegmentSamples: Map<string, number>;
  private currentSegmentKey: string | null;
  private initialized: boolean;

  private constructor() {
    this.sampleHistory = new Map();
    this.currentSegmentSamples = new Map();
    this.currentSegmentKey = null;
    this.initialized = false;
  }

  public static async getInstance(): Promise<MonteCarloHandler> {
    if (MonteCarloHandler.instance && MonteCarloHandler.instance.initialized) {
      return MonteCarloHandler.instance;
    }

    if (!MonteCarloHandler.initializationPromise) {
      MonteCarloHandler.initializationPromise = MonteCarloHandler.createAndInitialize();
    }

    return MonteCarloHandler.initializationPromise;
  }

  private static async createAndInitialize(): Promise<MonteCarloHandler> {
    const handler = new MonteCarloHandler();
    await handler.initialize();
    MonteCarloHandler.instance = handler;
    return handler;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const dataDir = path.join(__dirname, '..', '..', '..', 'data');
      
      const historicRatesPath = path.join(dataDir, 'historicRates.json');
      const historicRatesContent = await fs.readFile(historicRatesPath, 'utf-8');
      this.historicRates = JSON.parse(historicRatesContent);

      const portfolioMakeupPath = path.join(dataDir, 'portfolioMakeupOverTime.json');
      const portfolioMakeupContent = await fs.readFile(portfolioMakeupPath, 'utf-8');
      this.portfolioMakeup = JSON.parse(portfolioMakeupContent);

      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize MonteCarloHandler: ${error}`);
    }
  }

  public getSample(
    type: MonteCarloSampleType,
    date: Date,
    segmentKey: string
  ): number {
    if (!this.initialized || !this.historicRates) {
      throw new Error('MonteCarloHandler not initialized');
    }

    if (segmentKey !== this.currentSegmentKey) {
      this.clearSegmentCache();
      this.currentSegmentKey = segmentKey;
    }

    const cacheKey = `${type}-${segmentKey}`;
    if (this.currentSegmentSamples.has(cacheKey)) {
      return this.currentSegmentSamples.get(cacheKey)!;
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
        sample = this.calculatePortfolioSample(composition, segmentKey);
        break;
      case MonteCarloSampleType.INFLATION:
        sample = this.drawRandomSample(this.historicRates.inflation);
        break;
      case MonteCarloSampleType.RAISE:
        sample = this.drawRandomSample(this.historicRates.raise);
        break;
      default:
        throw new Error(`Unknown Monte Carlo sample type: ${type}`);
    }

    this.currentSegmentSamples.set(cacheKey, sample);
    
    const record: SampleRecord = {
      date,
      type,
      value: sample,
      segmentKey
    };
    
    if (!this.sampleHistory.has(segmentKey)) {
      this.sampleHistory.set(segmentKey, []);
    }
    this.sampleHistory.get(segmentKey)!.push(record);

    return sample;
  }

  public clearSegmentCache(): void {
    this.currentSegmentSamples.clear();
    this.currentSegmentKey = null;
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

    const years = Object.keys(this.portfolioMakeup).map(Number).sort((a, b) => a - b);
    
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

  private calculatePortfolioSample(
    composition: PortfolioComposition,
    segmentKey: string
  ): number {
    if (!this.historicRates) {
      throw new Error('Historic rates not loaded');
    }

    let totalReturn = 0;

    if (composition.cash > 0 && this.historicRates.investment.cash) {
      const cashReturn = this.drawRandomSample(this.historicRates.investment.cash);
      totalReturn += cashReturn * composition.cash;
    }

    if (composition.stock > 0 && this.historicRates.investment.stock) {
      const stockReturn = this.drawRandomSample(this.historicRates.investment.stock);
      totalReturn += stockReturn * composition.stock;
    }

    if (composition.bond > 0 && this.historicRates.investment.bond) {
      const bondReturn = this.drawRandomSample(this.historicRates.investment.bond);
      totalReturn += bondReturn * composition.bond;
    }

    if (composition.preferred > 0 && this.historicRates.investment.preferred) {
      const preferredReturn = this.resolveProxyAsset(
        this.historicRates.investment.preferred,
        segmentKey
      );
      totalReturn += preferredReturn * composition.preferred;
    }

    if (composition.convertible > 0 && this.historicRates.investment.convertible) {
      const convertibleReturn = this.resolveProxyAsset(
        this.historicRates.investment.convertible,
        segmentKey
      );
      totalReturn += convertibleReturn * composition.convertible;
    }

    if (composition.other > 0 && this.historicRates.investment.other) {
      const otherReturn = this.resolveProxyAsset(
        this.historicRates.investment.other,
        segmentKey
      );
      totalReturn += otherReturn * composition.other;
    }

    return totalReturn;
  }

  private resolveProxyAsset(
    proxyDef: ProxyDefinition,
    segmentKey: string
  ): number {
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
            assetReturn = this.resolveProxyAsset(
              this.historicRates.investment.preferred,
              segmentKey
            );
          }
          break;
        case 'convertible':
          if (this.historicRates.investment.convertible) {
            assetReturn = this.resolveProxyAsset(
              this.historicRates.investment.convertible,
              segmentKey
            );
          }
          break;
        case 'other':
          if (this.historicRates.investment.other) {
            assetReturn = this.resolveProxyAsset(
              this.historicRates.investment.other,
              segmentKey
            );
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