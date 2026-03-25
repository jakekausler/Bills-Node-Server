// portfolio-types.ts — All types for the portfolio modeling system

export type PortfolioMode = 'estimated' | 'fund-level';

export interface AssetAllocation {
  stock?: number;
  bond?: number;
  cash?: number;
  preferred?: number;
  convertible?: number;
  other?: number;
}

export interface FundDividendConfig {
  frequency: 'monthly' | 'quarterly' | 'semiannually' | 'annually';
  dividendType: 'qualified' | 'ordinary' | 'mixed';
  qualifiedPercent?: number;
  reinvest: boolean;
  history: Array<{ year: number; perShareAmount: number }>;
}

export interface FundConfig {
  symbol: string;
  name: string;
  assetClassMapping: AssetAllocation;
  currentShares: number;
  currentPrice: number;
  expenseRatio: number;
  contributionWeight: number;
  dividends: FundDividendConfig;
}

export interface BucketConfig {
  reserveAsset: string;
  reserveTarget: number;
  reserveInflationVariable?: string;
}

export interface RebalancingConfig {
  enabled: boolean;
  checkFrequency: 'monthly' | 'quarterly' | 'semiannually' | 'annually';
  driftThreshold: number;
}

export interface AccountPortfolioConfig {
  mode: 'estimated' | 'fund-level';
  allocation: AssetAllocation;
  glidePath: 'global' | 'custom' | 'none';
  customGlidePath?: Record<number, AssetAllocation>;
  lotSelectionStrategy: 'fifo' | 'highest-cost';
  rebalancing?: RebalancingConfig;
  bucket?: BucketConfig;
  funds?: FundConfig[];
  cashReserve?: {
    amount: number;
    returnRate: number;
  };
}

export interface PortfolioTransaction {
  id: string;
  sourceId?: string;    // dedup key from brokerage import (e.g., "goretire:FITID123")
  accountId?: string;   // app account ID for ledger storage
  memo?: string;        // original brokerage description
  date: string;
  type: 'buy' | 'sell' | 'reinvest' | 'dividend' | 'transfer-in' | 'transfer-out' | 'split' | 'fee';
  fundSymbol: string;
  shares: number;
  pricePerShare: number;
  totalAmount: number;
  fees: number;
  lotId?: string;
  source?: 'contribution' | 'conversion' | 'reinvestment' | 'rebalance' | 'transfer' | 'manual';
  isProjected: boolean;
  isEstimated: boolean;
}

export interface Lot {
  id: string;
  accountId: string;
  fundSymbol: string;
  shares: number;
  costBasisPerShare: number;
  totalCost: number;
  purchaseDate: string;
  source: 'contribution' | 'conversion' | 'reinvestment' | 'rebalance' | 'transfer' | 'manual';
}

export interface LotSellDetail {
  lotId: string;
  fundSymbol: string;
  shares: number;
  costBasisPerShare: number;
  sellPrice: number;
  proceeds: number;       // shares * sellPrice
  costBasis: number;      // shares * costBasisPerShare
  gain: number;           // proceeds - costBasis
  holdingPeriod: 'short' | 'long';  // > 1 year from purchase = long
}

export interface SellResult {
  totalProceeds: number;
  totalBasis: number;
  shortTermGain: number;
  longTermGain: number;
  lotDetails: LotSellDetail[];
  transactions: PortfolioTransaction[];
}

export interface FundPosition {
  symbol: string;
  shares: number;
  currentPrice: number;
  value: number;
}

export interface AccountPortfolioState {
  accountId: string;
  mode: 'estimated' | 'fund-level';
  config: AccountPortfolioConfig;
  fundPositions: Map<string, FundPosition>;
  uninvestedCash: number;
  lots: Lot[];
  projectedTransactions: PortfolioTransaction[];
  simulatedPrices: Map<string, number>;
}
// Note: `projectedTransactions` (engine-generated) are stored in state.
// Actual transactions (user-entered/imported) are loaded from portfolioLedger.json
// and NOT stored in state — they are read-only input. This is an intentional
// deviation from the spec's `transactions` field name.
