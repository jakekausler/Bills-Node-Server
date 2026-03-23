/**
 * PortfolioManager — tracks per-fund positions and simulated prices per account.
 *
 * Accounts can be in two portfolio modes:
 * - fund-level: positions initialized from config with actual fund data
 * - estimated: virtual funds created from allocation weights and account balance
 *
 * Accounts not in the config map are treated as interest-mode (null from getAccountMode).
 */

import type { DebugLogger } from './debug-logger';
import type {
  AccountPortfolioConfig,
  AccountPortfolioState,
  FundPosition,
  PortfolioMode,
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

  // ---- Private helpers ----

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
