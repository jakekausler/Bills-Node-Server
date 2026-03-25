/**
 * Asset tracking types for personal property (homes, vehicles, appliances)
 */

/**
 * Failure distribution for replacement cycle Monte Carlo sampling
 */
export type FailureDistribution =
  | { type: 'weibull'; beta: number; eta: number }
  | { type: 'uniform'; min: number; max: number }
  | { type: 'normal'; mean: number; stddev: number }
  | { type: 'fixed'; years: number };

/**
 * Replacement cycle configuration for cyclical assets
 */
export interface ReplacementCycleData {
  expectedYears: number; // Deterministic replacement age
  distribution: FailureDistribution; // MC-sampled failure timing
  cost: number; // Base replacement cost in today's dollars
  costIsVariable: boolean; // If true, use costVariable for inflation
  costVariable: string | null; // Inflation variable name (e.g., "INFLATION")
  currentAge: number; // Years since last purchase or replacement
  warrantyYears: number; // Warranty period (0 = no warranty)
  tradeInValue: boolean; // If true, current value offsets replacement cost
}

/**
 * Asset data object for serialization/deserialization
 */
export interface AssetData {
  id: string;
  name: string;
  type: 'home' | 'vehicle' | 'appliance' | 'other';

  // Value tracking
  purchaseDate: string; // YYYY-MM-DD
  purchasePrice: number; // Cost basis for capital gains
  currentValue: number; // Last known value
  currentValueDate: string; // YYYY-MM-DD checkpoint date

  // Appreciation (mutually exclusive with depreciationSchedule)
  appreciation: number; // Static rate (e.g., 0.035 for 3.5%)
  appreciationIsVariable: boolean; // If true, use appreciationVariable
  appreciationVariable: string | null; // Variable name (e.g., "HOME_APPRECIATION")

  // Depreciation (mutually exclusive with appreciation fields)
  depreciationSchedule: number[] | null; // Age-indexed per-year loss rates

  // Replacement cycle (optional, for vehicles and appliances)
  replacementCycle: ReplacementCycleData | null;

  // Links to other entities
  linkedAccounts: string[]; // Account IDs (mortgage, loans)
  linkedBills: string[]; // Bill IDs (property tax, insurance)

  // Replacement expense target
  payFromAccount: string | null; // Account ID for replacement costs

  // Future phases (present but unused in batch 1)
  sellingCosts: number; // Percentage (e.g., 0.06)
  capitalGainsExclusion: number; // Dollar amount (e.g., 500000)
  saleRule: unknown | null; // Future: downsize/rent rules
  helocRule: unknown | null; // Future: HELOC config
  status: 'owned' | 'sold';
}

/**
 * Runtime Asset class type (with Date objects instead of strings)
 */
export interface Asset {
  id: string;
  name: string;
  type: 'home' | 'vehicle' | 'appliance' | 'other';

  // Value tracking
  purchaseDate: Date;
  purchasePrice: number;
  currentValue: number;
  currentValueDate: Date;

  // Appreciation
  appreciation: number;
  appreciationIsVariable: boolean;
  appreciationVariable: string | null;

  // Depreciation
  depreciationSchedule: number[] | null;

  // Replacement cycle
  replacementCycle: ReplacementCycleData | null;

  // Links
  linkedAccounts: string[];
  linkedBills: string[];

  // Replacement target
  payFromAccount: string | null;

  // Future phases
  sellingCosts: number;
  capitalGainsExclusion: number;
  saleRule: unknown | null;
  helocRule: unknown | null;
  status: 'owned' | 'sold';
}
