import { AssetAllocation, FundConfig } from './portfolio-types';

export interface FutureLot {
  id: string;
  accountId: string;
  assetClass: string;         // 'stock', 'bond', 'cash'
  shares: number;
  costBasisPerShare: number;
  purchaseDate: string;       // YYYY-MM-DD
  source: 'historical' | 'contribution' | 'dividend';
}

export interface LotConsumedDetail {
  lotId: string;
  shares: number;
  costBasis: number;
  proceeds: number;
  gain: number;
  holdingPeriod: 'short' | 'long';
}

export interface CapitalGainsResult {
  shortTermGain: number;
  longTermGain: number;
  netGain: number;
  lotsConsumed: LotConsumedDetail[];
}

export class FutureLotTracker {
  private lots: Map<string, FutureLot[]>;
  private virtualPrices: Map<string, number>;
  private returnsAppliedYears: Set<string>;

  private lotsCheckpoint: string | null = null;
  private pricesCheckpoint: string | null = null;
  private returnsCheckpoint: string | null = null;

  private nextLotId: number = 0;
  private nextLotIdCheckpoint: number = 0;

  // Tolerance for floating-point dust when determining full vs partial lot consumption ($0.01)
  private static readonly CONSUMPTION_EPSILON = 0.01;

  // Asset class collapse rules: preferred/convertible/other → stock, rest unchanged
  private static readonly CLASS_COLLAPSE: Record<string, string> = {
    preferred: 'stock',
    other: 'stock',
    convertible: 'bond',
    stock: 'stock',
    bond: 'bond',
    cash: 'cash',
  };

  constructor() {
    this.lots = new Map();
    this.virtualPrices = new Map();
    this.returnsAppliedYears = new Set();
  }

  private generateLotId(): string {
    return `fl-${this.nextLotId++}`;
  }

  private collapseAssetClass(assetClass: string): string {
    return FutureLotTracker.CLASS_COLLAPSE[assetClass.toLowerCase()] ?? 'stock';
  }

  seedFromHistory(
    accountId: string,
    sharesByFund: Record<string, number>,
    totalCostBasis: number,
    fundConfigs: FundConfig[],
    cutoffDate: string,
    fundPrices: Record<string, number>,
  ): void {
    const fundConfigMap = new Map(fundConfigs.map(fc => [fc.symbol.toLowerCase(), fc]));

    // Accumulate per-asset-class values and cost basis
    const perClassAccumulator: Record<string, { value: number; costBasis: number }> = {};

    let totalComputedValue = 0;

    for (const [symbol, shares] of Object.entries(sharesByFund)) {
      const price = fundPrices[symbol];
      if (price === undefined) {
        continue;
      }

      const fundValue = shares * price;
      totalComputedValue += fundValue;

      const fundConfig = fundConfigMap.get(symbol.toLowerCase());
      if (!fundConfig) {
        continue;
      }

      for (const [className, weight] of Object.entries(fundConfig.assetClassMapping)) {
        if (!weight) continue;
        const collapsed = this.collapseAssetClass(className);
        if (!perClassAccumulator[collapsed]) {
          perClassAccumulator[collapsed] = { value: 0, costBasis: 0 };
        }
        perClassAccumulator[collapsed].value += fundValue * weight;
      }
    }

    if (totalComputedValue <= 0) {
      return;
    }

    // Compute two years before cutoff date for long-term holding
    const cutoffDateObj = new Date(cutoffDate + 'T12:00:00Z');
    const purchaseDateObj = new Date(cutoffDateObj);
    purchaseDateObj.setUTCFullYear(purchaseDateObj.getUTCFullYear() - 2);
    const purchaseDate = purchaseDateObj.toISOString().split('T')[0];

    // Create lots for each asset class
    for (const [assetClass, { value: classValue }] of Object.entries(perClassAccumulator)) {
      if (classValue <= 0) {
        continue;
      }

      // Initialize virtual prices explicitly before lot creation
      if (!this.virtualPrices.has(assetClass)) {
        this.virtualPrices.set(assetClass, 100);
      }

      // Proportional approximation: assumes uniform gain/loss ratio across all funds
      const classCostBasis = totalCostBasis * (classValue / totalComputedValue);
      const virtualPrice = this.virtualPrices.get(assetClass) ?? 100;
      const virtualShares = classValue / virtualPrice;
      const costBasisPerShare = classCostBasis / virtualShares;

      if (!this.lots.has(accountId)) {
        this.lots.set(accountId, []);
      }

      const lot: FutureLot = {
        id: this.generateLotId(),
        accountId,
        assetClass,
        shares: virtualShares,
        costBasisPerShare,
        purchaseDate,
        source: 'historical',
      };

      this.lots.get(accountId)!.push(lot);
    }
  }

  deposit(
    accountId: string,
    amount: number,
    date: string,
    allocation: AssetAllocation,
    source: 'contribution' | 'dividend' = 'contribution',
  ): FutureLot[] {
    const created: FutureLot[] = [];

    // Normalize allocation weights
    const weights = Object.entries(allocation).filter(([_, weight]) => weight > 0);
    const totalWeight = weights.reduce((sum, [_, weight]) => sum + weight, 0);

    if (totalWeight <= 0) {
      return created;
    }

    if (!this.lots.has(accountId)) {
      this.lots.set(accountId, []);
    }

    for (const [className, weight] of weights) {
      if (!weight) continue;
      const normalizedWeight = weight / totalWeight;
      const collapsed = this.collapseAssetClass(className);
      const classAmount = amount * normalizedWeight;
      const virtualPrice = this.virtualPrices.get(collapsed) ?? 100;
      const shares = classAmount / virtualPrice;

      const lot: FutureLot = {
        id: this.generateLotId(),
        accountId,
        assetClass: collapsed,
        shares,
        costBasisPerShare: virtualPrice,
        purchaseDate: date,
        source,
      };

      this.lots.get(accountId)!.push(lot);
      created.push(lot);
    }

    return created;
  }

  private recordSale(
    lot: FutureLot,
    sharesToSell: number,
    currentVirtualPrice: number,
    sellDate: string,
    result: CapitalGainsResult,
  ): void {
    const proceeds = sharesToSell * currentVirtualPrice;
    const costBasis = sharesToSell * lot.costBasisPerShare;
    const gain = proceeds - costBasis;
    const holdingPeriod = this.isLongTerm(lot.purchaseDate, sellDate) ? 'long' : 'short';

    result.lotsConsumed.push({
      lotId: lot.id,
      shares: sharesToSell,
      costBasis,
      proceeds,
      gain,
      holdingPeriod,
    });

    if (holdingPeriod === 'long') {
      result.longTermGain += gain;
    } else {
      result.shortTermGain += gain;
    }
  }

  withdraw(
    accountId: string,
    amount: number,
    date: string,
    strategy: 'fifo' | 'highest-cost' = 'fifo',
  ): CapitalGainsResult {
    const result: CapitalGainsResult = {
      shortTermGain: 0,
      longTermGain: 0,
      netGain: 0,
      lotsConsumed: [],
    };

    const accountLots = this.lots.get(accountId);
    if (!accountLots || accountLots.length === 0) {
      return result;
    }

    // Compute total market value across all lots
    let totalValue = 0;
    for (const lot of accountLots) {
      const lotValue = lot.shares * (this.virtualPrices.get(lot.assetClass) ?? 100);
      totalValue += lotValue;
    }

    if (totalValue <= 0) {
      return result;
    }

    // Calculate amount to sell per asset class (proportional)
    const perClassAmounts: Record<string, number> = {};
    for (const lot of accountLots) {
      if (!perClassAmounts[lot.assetClass]) {
        perClassAmounts[lot.assetClass] = 0;
      }
      const lotValue = lot.shares * (this.virtualPrices.get(lot.assetClass) ?? 100);
      perClassAmounts[lot.assetClass] += lotValue;
    }

    const remainingByClass: Record<string, number> = {};
    for (const [assetClass, classValue] of Object.entries(perClassAmounts)) {
      remainingByClass[assetClass] = amount * (classValue / totalValue);
    }

    // Track fully consumed lot IDs across all asset classes
    const consumedLotIds = new Set<string>();

    // Process each asset class
    for (const assetClass of Object.keys(remainingByClass)) {
      // classLots contains references to objects in accountLots — mutations are intentional
      const classLots = accountLots.filter(lot => lot.assetClass === assetClass);
      const remaining = remainingByClass[assetClass];

      if (remaining <= 0 || classLots.length === 0) {
        continue;
      }

      // Sort lots by strategy
      if (strategy === 'fifo') {
        classLots.sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
      } else if (strategy === 'highest-cost') {
        classLots.sort((a, b) => b.costBasisPerShare - a.costBasisPerShare);
      }

      let remainingAmount = remaining;

      for (let i = 0; i < classLots.length && remainingAmount > 0; i++) {
        const lot = classLots[i];
        const currentVirtualPrice = this.virtualPrices.get(assetClass) ?? 100;
        const lotValue = lot.shares * currentVirtualPrice;

        if (lotValue <= remainingAmount + FutureLotTracker.CONSUMPTION_EPSILON) {
          // Consume entire lot
          this.recordSale(lot, lot.shares, currentVirtualPrice, date, result);
          remainingAmount -= lotValue;
          consumedLotIds.add(lot.id);
        } else {
          // Partial consumption; if amount > totalValue, sells everything available; caller receives partial fill
          const sharesToSell = remainingAmount / currentVirtualPrice;
          this.recordSale(lot, sharesToSell, currentVirtualPrice, date, result);
          lot.shares -= sharesToSell;
          remainingAmount = 0;
        }
      }
    }

    // Remove fully consumed lots from accountLots
    const survivingLots = accountLots.filter(lot => !consumedLotIds.has(lot.id));
    if (survivingLots.length > 0) {
      this.lots.set(accountId, survivingLots);
    } else {
      this.lots.delete(accountId);
    }

    result.netGain = result.shortTermGain + result.longTermGain;
    return result;
  }

  private isLongTerm(purchaseDate: string, sellDate: string): boolean {
    const purchase = new Date(purchaseDate + 'T12:00:00Z');
    const sell = new Date(sellDate + 'T12:00:00Z');
    const oneYearLater = new Date(purchase);
    oneYearLater.setUTCFullYear(oneYearLater.getUTCFullYear() + 1);
    return sell > oneYearLater;
  }

  applyAnnualReturns(year: number, assetClassReturns: Record<string, number>): void {
    // Only the 3 virtual classes are tracked; preferred/convertible/other are collapsed during seeding
    for (const assetClass of ['stock', 'bond', 'cash']) {
      const key = `${assetClass}-${year}`;
      if (this.returnsAppliedYears.has(key)) {
        continue;
      }
      this.returnsAppliedYears.add(key);

      const returnRate = assetClassReturns[assetClass];
      if (returnRate === undefined) {
        continue;
      }

      const currentPrice = this.virtualPrices.get(assetClass) ?? 100;
      this.virtualPrices.set(assetClass, currentPrice * (1 + returnRate));
    }
  }

  getCostBasis(accountId: string): number {
    const accountLots = this.lots.get(accountId);
    if (!accountLots) {
      return 0;
    }
    return accountLots.reduce((sum, lot) => sum + lot.shares * lot.costBasisPerShare, 0);
  }

  getMarketValue(accountId: string): number {
    const accountLots = this.lots.get(accountId);
    if (!accountLots) {
      return 0;
    }
    return accountLots.reduce((sum, lot) => {
      const price = this.virtualPrices.get(lot.assetClass) ?? 100;
      return sum + lot.shares * price;
    }, 0);
  }

  getGainRatio(accountId: string): number {
    const marketValue = this.getMarketValue(accountId);
    const costBasis = this.getCostBasis(accountId);
    if (marketValue <= 0) {
      return 0;
    }
    return (marketValue - costBasis) / marketValue;
  }

  checkpoint(): void {
    this.lotsCheckpoint = JSON.stringify(Array.from(this.lots.entries()));
    this.pricesCheckpoint = JSON.stringify(Array.from(this.virtualPrices.entries()));
    this.returnsCheckpoint = JSON.stringify(Array.from(this.returnsAppliedYears));
    this.nextLotIdCheckpoint = this.nextLotId;
  }

  restore(): void {
    if (this.lotsCheckpoint === null) {
      return;
    }
    this.lots = new Map(JSON.parse(this.lotsCheckpoint));
    this.virtualPrices = new Map(JSON.parse(this.pricesCheckpoint!));
    this.returnsAppliedYears = new Set(JSON.parse(this.returnsCheckpoint!));
    this.nextLotId = this.nextLotIdCheckpoint;
  }
}
