/**
 * PortfolioManager — tracks per-fund positions and simulated prices per account.
 *
 * Accounts can be in two portfolio modes:
 * - fund-level: positions initialized from config with actual fund data
 * - estimated: virtual funds created from allocation weights and account balance
 *
 * Accounts not in the config map are treated as interest-mode (null from getAccountMode).
 */

import dayjs from 'dayjs';
import type { DebugLogger } from './debug-logger';
import type {
  AccountPortfolioConfig,
  AccountPortfolioState,
  FundPosition,
  Lot,
  LotSellDetail,
  PortfolioMode,
  PortfolioTransaction,
  SellResult,
} from './portfolio-types';

export class PortfolioManager {
  private configs: Map<string, AccountPortfolioConfig>;
  private states: Map<string, AccountPortfolioState>;
  private lastReturnYear: Map<string, number>;
  private debugLogger: DebugLogger | null;
  private simNumber: number;

  constructor(
    configs: Record<string, AccountPortfolioConfig>,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
  ) {
    this.configs = new Map(Object.entries(configs));
    this.states = new Map();
    this.lastReturnYear = new Map();
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;

    // Initialize fund-level accounts immediately from config
    for (const [accountId, config] of this.configs) {
      if (config.mode === 'fund-level') {
        this.initializeAccount(accountId, config);
      } else {
        // Estimated accounts get an empty state; initializeEstimatedAccount must be called later
        this.states.set(accountId, {
          accountId,
          mode: 'estimated',
          config,
          fundPositions: new Map(),
          uninvestedCash: 0,
          lots: [],
          projectedTransactions: [],
          simulatedPrices: new Map(),
        });
      }
    }
  }

  /**
   * Returns 'estimated' | 'fund-level' | null.
   * null means the account is not in portfolio config (interest mode).
   */
  getAccountMode(accountId: string): PortfolioMode | null {
    const config = this.configs.get(accountId);
    if (!config) return null;
    return config.mode;
  }

  /**
   * Returns all account IDs that have portfolio configurations.
   */
  getConfiguredAccountIds(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Initialize a fund-level account from its config.
   * Creates positions from currentShares/currentPrice in each fund.
   */
  initializeAccount(accountId: string, config: AccountPortfolioConfig): void {
    const fundPositions = new Map<string, FundPosition>();
    const simulatedPrices = new Map<string, number>();

    if (config.funds) {
      for (const fund of config.funds) {
        const value = fund.currentShares * fund.currentPrice;
        fundPositions.set(fund.symbol, {
          symbol: fund.symbol,
          shares: fund.currentShares,
          currentPrice: fund.currentPrice,
          value,
        });
        simulatedPrices.set(fund.symbol, fund.currentPrice);
      }
    }

    this.states.set(accountId, {
      accountId,
      mode: 'fund-level',
      config,
      fundPositions,
      uninvestedCash: 0,
      lots: [],
      projectedTransactions: [],
      simulatedPrices,
    });

    this.log('init-fund-level', {
      accountId,
      fundCount: fundPositions.size,
      totalValue: this.getTotalValue(accountId),
    });
  }

  /**
   * Initialize an estimated-mode account with virtual funds from balance.
   * Creates one virtual fund per non-zero allocation entry.
   */
  initializeEstimatedAccount(accountId: string, currentBalance: number): void {
    const config = this.configs.get(accountId);
    if (!config || config.mode !== 'estimated') return;

    const fundPositions = new Map<string, FundPosition>();
    const simulatedPrices = new Map<string, number>();
    const allocation = config.allocation;

    for (const [className, weight] of Object.entries(allocation)) {
      if (!weight || weight <= 0) continue;

      const symbol = className.toUpperCase();
      const shares = currentBalance * weight;
      const price = 1.0;

      fundPositions.set(symbol, {
        symbol,
        shares,
        currentPrice: price,
        value: shares * price,
      });
      simulatedPrices.set(symbol, price);
    }

    const state = this.states.get(accountId);
    if (state) {
      state.fundPositions = fundPositions;
      state.simulatedPrices = simulatedPrices;
    }

    this.log('init-estimated', {
      accountId,
      balance: currentBalance,
      fundCount: fundPositions.size,
    });
  }

  /**
   * Apply annual returns to all funds in an account.
   * Uses lastReturnYear to gate — only fires once per year per account.
   * Returns total interest earned.
   */
  applyAnnualReturns(
    accountId: string,
    year: number,
    assetClassReturns: Record<string, number>,
  ): number {
    // Gate: only apply once per year per account
    if (this.lastReturnYear.get(accountId) === year) {
      return 0;
    }
    this.lastReturnYear.set(accountId, year);

    const state = this.states.get(accountId);
    if (!state) return 0;

    let totalInterest = 0;

    for (const [symbol, position] of state.fundPositions) {
      const oldValue = position.value;

      // Get fund config for asset class mapping and expense ratio
      const fundConfig = state.config.funds?.find((f) => f.symbol === symbol);
      const assetClassMapping = fundConfig?.assetClassMapping ?? this.getVirtualFundMapping(symbol);
      const expenseRatio = fundConfig?.expenseRatio ?? 0;

      // Compute weighted return from asset class mapping
      let weightedReturn = 0;
      for (const [className, weight] of Object.entries(assetClassMapping)) {
        if (!weight) continue;
        const classReturn = assetClassReturns[className] ?? 0;
        weightedReturn += weight * classReturn;
      }

      // Deduct expense ratio
      const netReturn = weightedReturn - expenseRatio;

      // Update simulated price
      const newPrice = position.currentPrice * (1 + netReturn);
      position.currentPrice = newPrice;
      position.value = position.shares * newPrice;
      state.simulatedPrices.set(symbol, newPrice);

      totalInterest += position.value - oldValue;
    }

    this.log('apply-annual-returns', {
      accountId,
      year,
      totalInterest,
      positionCount: state.fundPositions.size,
    });

    return totalInterest;
  }

  /**
   * Get total account value (sum of positions + uninvested cash).
   */
  getTotalValue(accountId: string): number {
    const state = this.states.get(accountId);
    if (!state) return 0;

    let total = state.uninvestedCash;
    for (const [, position] of state.fundPositions) {
      total += position.value;
    }
    return total;
  }

  /**
   * Get positions for one account.
   */
  getPositions(accountId: string): FundPosition[] {
    const state = this.states.get(accountId);
    if (!state) return [];
    return Array.from(state.fundPositions.values());
  }

  /**
   * Get positions for ALL accounts.
   */
  getAllPositions(): Record<string, FundPosition[]> {
    const result: Record<string, FundPosition[]> = {};
    for (const [accountId] of this.states) {
      result[accountId] = this.getPositions(accountId);
    }
    return result;
  }

  /**
   * Checkpoint state for push/pull reprocessing.
   * Maps are converted to plain objects for JSON serialization.
   */
  checkpoint(): string {
    const serialized: Record<string, unknown> = {};

    for (const [accountId, state] of this.states) {
      serialized[accountId] = {
        accountId: state.accountId,
        mode: state.mode,
        fundPositions: Object.fromEntries(state.fundPositions),
        uninvestedCash: state.uninvestedCash,
        simulatedPrices: Object.fromEntries(state.simulatedPrices),
        lots: state.lots,
        projectedTransactions: state.projectedTransactions,
      };
    }

    const lastReturnYear = Object.fromEntries(this.lastReturnYear);

    return JSON.stringify({ states: serialized, lastReturnYear });
  }

  /**
   * Restore state from a checkpoint string.
   */
  restore(data: string): void {
    const parsed = JSON.parse(data) as {
      states: Record<string, {
        accountId: string;
        mode: 'estimated' | 'fund-level';
        fundPositions: Record<string, FundPosition>;
        uninvestedCash: number;
        simulatedPrices: Record<string, number>;
        lots?: Lot[];
        projectedTransactions?: PortfolioTransaction[];
      }>;
      lastReturnYear: Record<string, number>;
    };

    // Restore lastReturnYear
    this.lastReturnYear = new Map(Object.entries(parsed.lastReturnYear).map(
      ([k, v]) => [k, v as number],
    ));

    // Restore states
    for (const [accountId, snap] of Object.entries(parsed.states)) {
      const state = this.states.get(accountId);
      if (!state) continue;

      state.mode = snap.mode;
      state.uninvestedCash = snap.uninvestedCash;
      state.fundPositions = new Map(Object.entries(snap.fundPositions));
      state.simulatedPrices = new Map(Object.entries(snap.simulatedPrices));
      state.lots = snap.lots ?? [];
      state.projectedTransactions = snap.projectedTransactions ?? [];
    }
  }

  /**
   * Reset all states back to initial config values for a new MC simulation.
   */
  resetStates(): void {
    this.lastReturnYear.clear();

    for (const [accountId, config] of this.configs) {
      if (config.mode === 'fund-level') {
        this.initializeAccount(accountId, config);
      } else {
        // Reset estimated accounts to empty (need initializeEstimatedAccount again)
        this.states.set(accountId, {
          accountId,
          mode: 'estimated',
          config,
          fundPositions: new Map(),
          uninvestedCash: 0,
          lots: [],
          projectedTransactions: [],
          simulatedPrices: new Map(),
        });
      }
    }
  }

  /**
   * Get account state (for testing and external inspection).
   */
  getAccountState(accountId: string): AccountPortfolioState | undefined {
    return this.states.get(accountId);
  }

  /**
   * Create a new lot for an account + fund.
   */
  createLot(
    accountId: string,
    fundSymbol: string,
    shares: number,
    pricePerShare: number,
    date: string,
    source: Lot['source'],
  ): Lot {
    const state = this.states.get(accountId);
    if (!state) {
      throw new Error(`No portfolio state for account ${accountId}`);
    }

    const lot: Lot = {
      id: `${accountId}-${fundSymbol}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      accountId,
      fundSymbol,
      shares,
      costBasisPerShare: pricePerShare,
      totalCost: shares * pricePerShare,
      purchaseDate: date,
      source,
    };

    state.lots.push(lot);

    this.log('lot-created', {
      accountId,
      fundSymbol,
      shares,
      pricePerShare,
      lotId: lot.id,
    });

    return lot;
  }

  /**
   * Consume lots for a sell operation using the account's lot selection strategy.
   * Returns a SellResult with per-lot details and gain classification.
   */
  consumeLots(
    accountId: string,
    fundSymbol: string,
    sharesToSell: number,
    sellPrice: number,
    sellDate: string,
  ): SellResult {
    const state = this.states.get(accountId);
    if (!state) {
      throw new Error(`No portfolio state for account ${accountId}`);
    }

    // Filter lots for this fund with remaining shares
    const eligibleLots = state.lots.filter(
      (l) => l.fundSymbol === fundSymbol && l.shares > 0,
    );

    // Sort by strategy
    const strategy = state.config.lotSelectionStrategy;
    if (strategy === 'highest-cost') {
      eligibleLots.sort((a, b) => b.costBasisPerShare - a.costBasisPerShare);
    } else {
      // FIFO: oldest first
      eligibleLots.sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
    }

    let remaining = sharesToSell;
    const lotDetails: LotSellDetail[] = [];
    const transactions: PortfolioTransaction[] = [];
    let shortTermGain = 0;
    let longTermGain = 0;
    let totalProceeds = 0;
    let totalBasis = 0;

    for (const lot of eligibleLots) {
      if (remaining <= 0) break;

      const sharesToConsume = Math.min(lot.shares, remaining);
      lot.shares -= sharesToConsume;
      remaining -= sharesToConsume;

      const proceeds = sharesToConsume * sellPrice;
      const costBasis = sharesToConsume * lot.costBasisPerShare;
      const gain = proceeds - costBasis;
      const holdingDays = dayjs(sellDate).diff(dayjs(lot.purchaseDate), 'day');
      const holdingPeriod: 'short' | 'long' = holdingDays > 365 ? 'long' : 'short';

      if (holdingPeriod === 'long') {
        longTermGain += gain;
      } else {
        shortTermGain += gain;
      }
      totalProceeds += proceeds;
      totalBasis += costBasis;

      lotDetails.push({
        lotId: lot.id,
        fundSymbol,
        shares: sharesToConsume,
        costBasisPerShare: lot.costBasisPerShare,
        sellPrice,
        proceeds,
        costBasis,
        gain,
        holdingPeriod,
      });

      const tx: PortfolioTransaction = {
        id: `sell-${lot.id}-${sellDate}`,
        date: sellDate,
        type: 'sell',
        fundSymbol,
        shares: sharesToConsume,
        pricePerShare: sellPrice,
        totalAmount: proceeds,
        fees: 0,
        lotId: lot.id,
        isProjected: true,
        isEstimated: false,
      };
      transactions.push(tx);
      state.projectedTransactions.push(tx);
    }

    this.log('consume-lots', {
      accountId,
      fundSymbol,
      sharesToSell,
      sellPrice,
      lotsConsumed: lotDetails.length,
      shortTermGain,
      longTermGain,
    });

    return {
      totalProceeds,
      totalBasis,
      shortTermGain,
      longTermGain,
      lotDetails,
      transactions,
    };
  }

  /**
   * Execute a buy order: purchase shares of a fund with uninvested cash.
   * Creates a lot, updates the fund position, and decreases uninvested cash.
   */
  executeBuy(
    accountId: string,
    fundSymbol: string,
    amount: number,
    date: string,
    source: Lot['source'],
  ): PortfolioTransaction {
    const state = this.states.get(accountId);
    if (!state) {
      throw new Error(`No portfolio state for account ${accountId}`);
    }

    // Get the fund's current simulated price
    const price = state.simulatedPrices.get(fundSymbol);
    if (price === undefined || price === 0) {
      throw new Error(`No simulated price for fund ${fundSymbol} in account ${accountId}`);
    }

    // Compute shares
    const shares = amount / price;

    // Create lot
    const lot = this.createLot(accountId, fundSymbol, shares, price, date, source);

    // Update fund position
    const position = state.fundPositions.get(fundSymbol);
    if (position) {
      position.shares += shares;
      position.value = position.shares * position.currentPrice;
    }

    // Decrease uninvested cash
    state.uninvestedCash -= amount;

    // Create and store transaction
    const tx: PortfolioTransaction = {
      id: `buy-${lot.id}`,
      date,
      type: 'buy',
      fundSymbol,
      shares,
      pricePerShare: price,
      totalAmount: amount,
      fees: 0,
      lotId: lot.id,
      source,
      isProjected: true,
      isEstimated: state.mode === 'estimated',
    };
    state.projectedTransactions.push(tx);

    this.log('buy-executed', {
      accountId,
      fundSymbol,
      shares,
      price,
      amount,
      lotId: lot.id,
    });

    return tx;
  }

  /**
   * Execute a sell order: sell shares of a fund, consuming lots per strategy.
   * Updates the fund position, increases uninvested cash by proceeds.
   * Takes SHARES (not dollars) — dollar-to-share conversion happens in executeWithdrawal.
   */
  executeSell(
    accountId: string,
    fundSymbol: string,
    shares: number,
    date: string,
  ): SellResult {
    const state = this.states.get(accountId);
    if (!state) {
      throw new Error(`No portfolio state for account ${accountId}`);
    }

    // Get the fund's current simulated price
    const price = state.simulatedPrices.get(fundSymbol);
    if (price === undefined || price === 0) {
      throw new Error(`No simulated price for fund ${fundSymbol} in account ${accountId}`);
    }

    // Consume lots
    const sellResult = this.consumeLots(accountId, fundSymbol, shares, price, date);

    // Update fund position
    const position = state.fundPositions.get(fundSymbol);
    if (position) {
      position.shares -= shares;
      position.value = position.shares * position.currentPrice;
    }

    // Increase uninvested cash by total proceeds (shares * price)
    const proceeds = shares * price;
    state.uninvestedCash += proceeds;

    // Create and store a summary sell transaction (lot-level txs already stored by consumeLots)
    // Note: consumeLots already stores per-lot sell transactions in projectedTransactions

    this.log('sell-executed', {
      accountId,
      fundSymbol,
      shares,
      price,
      proceeds,
      shortTermGain: sellResult.shortTermGain,
      longTermGain: sellResult.longTermGain,
      lotsConsumed: sellResult.lotDetails.length,
    });

    return sellResult;
  }

  /**
   * Execute a deposit: add cash and distribute into fund buys.
   * If bucket config exists, fills reserve first, then distributes remainder.
   * Otherwise distributes across all funds by contribution weight.
   */
  executeDeposit(
    accountId: string,
    amount: number,
    date: string,
    source: Lot['source'] = 'contribution',
  ): PortfolioTransaction[] {
    const state = this.states.get(accountId);
    if (!state) {
      throw new Error(`No portfolio state for account ${accountId}`);
    }

    // Add amount to uninvested cash (executeBuy will deduct from it)
    state.uninvestedCash += amount;

    const transactions: PortfolioTransaction[] = [];
    let remaining = amount;
    const bucket = state.config.bucket;

    // Step 1: If bucket config, fill reserve first
    if (bucket) {
      const reservePosition = state.fundPositions.get(bucket.reserveAsset);
      const reserveValue = reservePosition ? reservePosition.value : 0;
      // TODO(#25): inflation-adjust reserveTarget using reserveInflationVariable
      const target = bucket.reserveTarget;

      if (reserveValue < target) {
        const reserveBuyAmount = Math.min(remaining, target - reserveValue);
        if (reserveBuyAmount > 0) {
          const tx = this.executeBuy(accountId, bucket.reserveAsset, reserveBuyAmount, date, source);
          transactions.push(tx);
          remaining -= reserveBuyAmount;
        }
      }
    }

    // Step 2: Distribute remaining across non-reserve funds by contribution weight
    if (remaining > 0) {
      const weightedFunds = this.getContributionWeightedFunds(state, bucket?.reserveAsset);

      if (weightedFunds.length > 0) {
        const totalWeight = weightedFunds.reduce((sum, f) => sum + f.weight, 0);

        for (const { symbol, weight } of weightedFunds) {
          const normalizedWeight = weight / totalWeight;
          const fundAmount = remaining * normalizedWeight;
          if (fundAmount > 0) {
            const tx = this.executeBuy(accountId, symbol, fundAmount, date, source);
            transactions.push(tx);
          }
        }
      }
    }

    this.log('deposit-executed', {
      accountId,
      amount,
      source,
      buyCount: transactions.length,
      reserveFilled: bucket ? remaining < amount : false,
    });

    return transactions;
  }

  /**
   * Execute a withdrawal: sell fund positions to raise cash.
   * If bucket config, sells reserve first, then other funds proportionally by value.
   * Without bucket config, sells all funds proportionally by value weight.
   */
  executeWithdrawal(
    accountId: string,
    amount: number,
    date: string,
  ): { transactions: PortfolioTransaction[]; sellResults: SellResult[] } {
    const state = this.states.get(accountId);
    if (!state) {
      throw new Error(`No portfolio state for account ${accountId}`);
    }

    const allTransactions: PortfolioTransaction[] = [];
    const allSellResults: SellResult[] = [];
    let remaining = amount;
    const bucket = state.config.bucket;

    // Step 1: If bucket config, sell from reserve first
    if (bucket) {
      const reservePosition = state.fundPositions.get(bucket.reserveAsset);
      if (reservePosition && reservePosition.value > 0) {
        const reserveSellAmount = Math.min(remaining, reservePosition.value);
        if (reserveSellAmount > 0) {
          const price = state.simulatedPrices.get(bucket.reserveAsset);
          if (price && price > 0) {
            const sharesToSell = reserveSellAmount / price;
            const sellResult = this.executeSell(accountId, bucket.reserveAsset, sharesToSell, date);
            allTransactions.push(...sellResult.transactions);
            allSellResults.push(sellResult);
            remaining -= reserveSellAmount;
          }
        }
      }
    }

    // Step 2: If remaining > 0, sell from other funds proportionally by value
    if (remaining > 0) {
      const nonReserveFunds: Array<{ symbol: string; value: number }> = [];
      for (const [symbol, position] of state.fundPositions) {
        if (bucket && symbol === bucket.reserveAsset) continue;
        if (position.value > 0) {
          nonReserveFunds.push({ symbol, value: position.value });
        }
      }

      const totalNonReserveValue = nonReserveFunds.reduce((sum, f) => sum + f.value, 0);

      if (totalNonReserveValue > 0) {
        for (const { symbol, value } of nonReserveFunds) {
          const fundSellAmount = Math.min(
            remaining * (value / totalNonReserveValue),
            value,
          );
          if (fundSellAmount > 0) {
            const price = state.simulatedPrices.get(symbol);
            if (price && price > 0) {
              const sharesToSell = fundSellAmount / price;
              const sellResult = this.executeSell(accountId, symbol, sharesToSell, date);
              allTransactions.push(...sellResult.transactions);
              allSellResults.push(sellResult);
            }
          }
        }
      }
    }

    // Step 3: Decrease uninvested cash by actual proceeds
    // (executeSell increased it by proceeds; the withdrawal removes it)
    // Only subtract what was actually sold — don't go negative
    const actualProceeds = allSellResults.reduce((sum, r) => sum + r.totalProceeds, 0);
    state.uninvestedCash -= Math.min(amount, actualProceeds);

    this.log('withdrawal-executed', {
      accountId,
      amount,
      sellCount: allSellResults.length,
      totalProceeds: allSellResults.reduce((sum, sr) => sum + sr.totalProceeds, 0),
    });

    return { transactions: allTransactions, sellResults: allSellResults };
  }

  // ---- Roth Conversion Support ----

  /**
   * Execute a Roth conversion: sell from Traditional (source), buy into Roth (dest).
   * The sell side uses executeWithdrawal; the buy side uses executeDeposit with source 'conversion'.
   */
  executeRothConversion(
    sourceAccountId: string,
    destAccountId: string,
    amount: number,
    date: string,
  ): { sellResults: SellResult[]; buyTransactions: PortfolioTransaction[] } {
    // Sell from Traditional account
    const { sellResults } = this.executeWithdrawal(sourceAccountId, amount, date);

    // Buy into Roth account with source 'conversion'
    const buyTransactions = this.executeDeposit(destAccountId, amount, date, 'conversion');

    this.log('roth-conversion-executed', {
      sourceAccountId,
      destAccountId,
      amount,
      date,
      sellCount: sellResults.length,
      buyCount: buyTransactions.length,
    });

    return { sellResults, buyTransactions };
  }

  /**
   * Get total contribution basis in a Roth account.
   * Sum of current value of lots with source: 'contribution'.
   */
  getRothContributionBasis(accountId: string): number {
    const state = this.states.get(accountId);
    if (!state) return 0;

    let total = 0;
    for (const lot of state.lots) {
      if (lot.source === 'contribution' && lot.shares > 0) {
        total += lot.shares * lot.costBasisPerShare;
      }
    }
    return total;
  }

  /**
   * Get all conversion lots for a Roth account, sorted by purchaseDate (FIFO).
   */
  getRothConversionLots(accountId: string): Lot[] {
    const state = this.states.get(accountId);
    if (!state) return [];

    return state.lots
      .filter((l) => l.source === 'conversion' && l.shares > 0)
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate));
  }

  /**
   * Get penalty-free balance from a Roth account.
   * Contributions are always penalty-free.
   * Conversions are penalty-free after 5 years from conversion date.
   */
  getRothPenaltyFreeBalance(accountId: string, currentDate: string): number {
    const state = this.states.get(accountId);
    if (!state) return 0;

    let total = 0;
    const now = dayjs(currentDate);

    for (const lot of state.lots) {
      if (lot.shares <= 0) continue;
      const lotValue = lot.shares * lot.costBasisPerShare;

      if (lot.source === 'contribution') {
        // Contributions are always penalty-free
        total += lotValue;
      } else if (lot.source === 'conversion') {
        // Conversions are penalty-free after 5 years
        const yearsSinceConversion = now.diff(dayjs(lot.purchaseDate), 'year', true);
        if (yearsSinceConversion >= 5) {
          total += lotValue;
        }
      }
    }
    return total;
  }

  /**
   * Get penaltyable balance from a Roth account.
   * Conversions within the 5-year rule are subject to penalty.
   */
  getRothPenaltyableBalance(accountId: string, currentDate: string): number {
    const state = this.states.get(accountId);
    if (!state) return 0;

    let total = 0;
    const now = dayjs(currentDate);

    for (const lot of state.lots) {
      if (lot.shares <= 0) continue;
      if (lot.source === 'conversion') {
        const yearsSinceConversion = now.diff(dayjs(lot.purchaseDate), 'year', true);
        if (yearsSinceConversion < 5) {
          total += lot.shares * lot.costBasisPerShare;
        }
      }
    }
    return total;
  }

  // ---- Private helpers ----

  /**
   * Get funds with contribution weights for deposit distribution.
   * For fund-level: uses FundConfig.contributionWeight, excluding reserveAsset.
   * For estimated: uses allocation weights as contribution weights.
   */
  private getContributionWeightedFunds(
    state: AccountPortfolioState,
    reserveAsset?: string,
  ): Array<{ symbol: string; weight: number }> {
    if (state.mode === 'fund-level' && state.config.funds) {
      return state.config.funds
        .filter((f) => f.contributionWeight > 0 && f.symbol !== reserveAsset)
        .map((f) => ({ symbol: f.symbol, weight: f.contributionWeight }));
    }

    // Estimated mode: use allocation weights as contribution weights
    const result: Array<{ symbol: string; weight: number }> = [];
    for (const [className, weight] of Object.entries(state.config.allocation)) {
      if (!weight || weight <= 0) continue;
      const symbol = className.toUpperCase();
      if (symbol === reserveAsset) continue;
      result.push({ symbol, weight });
    }
    return result;
  }

  /**
   * For virtual funds (estimated mode), derive asset class mapping from symbol name.
   */
  private getVirtualFundMapping(symbol: string): Record<string, number> {
    const className = symbol.toLowerCase();
    return { [className]: 1.0 };
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'portfolio', event, ...data });
  }
}
