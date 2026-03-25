import * as fs from 'fs';
import * as path from 'path';
import { AssetAllocation, AccountPortfolioConfig } from './portfolio-types';

interface ExpectedReturns {
  returns: Record<string, number>;
}

type GlidePathData = Record<string, Record<string, number>>;
// Format: { "2023": { "stock": 0.79, "bond": 0.20, "cash": 0.01 }, ... }

let cachedGlidePath: GlidePathData | null = null;
let cachedExpectedReturns: ExpectedReturns | null = null;

function loadGlidePath(): GlidePathData {
  if (cachedGlidePath) return cachedGlidePath;
  try {
    const filePath = path.join(__dirname, '../../../data/portfolioMakeupOverTime.json');
    cachedGlidePath = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return cachedGlidePath!;
  } catch {
    cachedGlidePath = {};
    return cachedGlidePath;
  }
}

function loadExpectedReturns(): ExpectedReturns {
  if (cachedExpectedReturns) return cachedExpectedReturns;
  try {
    const filePath = path.join(__dirname, '../../../data/expectedReturns.json');
    cachedExpectedReturns = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return cachedExpectedReturns!;
  } catch {
    cachedExpectedReturns = {
      returns: { stock: 0.07, bond: 0.03, cash: 0.015 },
    };
    return cachedExpectedReturns;
  }
}

/**
 * Get the asset allocation for an account at a given year.
 * Uses per-account custom glide path, global glide path, or static allocation.
 */
export function getAllocationForYear(
  config: AccountPortfolioConfig,
  year: number,
): AssetAllocation {
  // Per-account custom glide path
  if (config.glidePath === 'custom' && config.customGlidePath) {
    return interpolateGlidePath(config.customGlidePath, year);
  }

  // Global glide path
  if (config.glidePath === 'global') {
    const globalPath = loadGlidePath();
    if (Object.keys(globalPath).length > 0) {
      return interpolateGlidePath(globalPath, year);
    }
  }

  // Static allocation (no glide path or glidePath === 'none')
  return config.allocation;
}

function interpolateGlidePath(
  glidePath: Record<string | number, AssetAllocation | Record<string, number>>,
  year: number,
): AssetAllocation {
  const years = Object.keys(glidePath).map(Number).sort((a, b) => a - b);
  if (years.length === 0) return { stock: 0.6, bond: 0.3, cash: 0.1 };

  // Before first year: use first
  if (year <= years[0]) return glidePath[years[0]] as AssetAllocation;

  // After last year: use last
  if (year >= years[years.length - 1]) return glidePath[years[years.length - 1]] as AssetAllocation;

  // Interpolate between two surrounding years
  let lowerYear = years[0];
  let upperYear = years[years.length - 1];
  for (const y of years) {
    if (y <= year) lowerYear = y;
    if (y >= year && upperYear >= y) upperYear = y;
  }

  if (lowerYear === upperYear) return glidePath[lowerYear] as AssetAllocation;

  const t = (year - lowerYear) / (upperYear - lowerYear);
  const lower = glidePath[lowerYear] as Record<string, number>;
  const upper = glidePath[upperYear] as Record<string, number>;

  const result: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(lower), ...Object.keys(upper)]);
  for (const key of allKeys) {
    const lv = lower[key] ?? 0;
    const uv = upper[key] ?? 0;
    result[key] = lv + (uv - lv) * t;
  }
  return result as AssetAllocation;
}

/**
 * Compute blended annual return rate from allocation and per-asset-class returns.
 */
export function computeBlendedRate(
  allocation: AssetAllocation,
  assetClassReturns: Record<string, number>,
): number {
  let blended = 0;
  for (const [assetClass, weight] of Object.entries(allocation)) {
    if (!weight) continue;
    const classReturn = assetClassReturns[assetClass] ?? 0;
    blended += weight * classReturn;
  }
  return blended;
}

/**
 * Get deterministic expected returns (price appreciation only).
 */
export function getExpectedReturns(): Record<string, number> {
  return loadExpectedReturns().returns;
}

/**
 * Compute the blended interest rate for a portfolio account at a given year.
 * In MC mode, pass per-asset-class sampled returns. In deterministic mode, uses expected returns.
 */
export function getBlendedInterestRate(
  config: AccountPortfolioConfig,
  year: number,
  mcAssetClassReturns?: Record<string, number> | null,
): number {
  const allocation = getAllocationForYear(config, year);
  const returns = mcAssetClassReturns || getExpectedReturns();
  return computeBlendedRate(allocation, returns);
}

/**
 * Compute the cash-reserve-aware interest rate for an account.
 * When a cash reserve is configured, balances up to the reserve amount earn the reserve rate.
 * Balances above the reserve earn the blended portfolio rate.
 */
export function getCashReserveAwareRate(
  config: AccountPortfolioConfig,
  year: number,
  balance: number,
  mcAssetClassReturns?: Record<string, number> | null,
): number {
  if (!config.cashReserve) {
    return getBlendedInterestRate(config, year, mcAssetClassReturns);
  }
  if (balance <= 0) return 0;

  const cashPortion = Math.min(balance, config.cashReserve.amount);
  const investedPortion = Math.max(0, balance - config.cashReserve.amount);

  // Cash rate: MC-sampled or deterministic reserve rate
  const cashRate = mcAssetClassReturns
    ? (mcAssetClassReturns['cash'] ?? config.cashReserve.returnRate)
    : config.cashReserve.returnRate;

  // Invested rate: blended from glide path
  const investedRate = investedPortion > 0
    ? getBlendedInterestRate(config, year, mcAssetClassReturns)
    : 0;

  return (cashPortion * cashRate + investedPortion * investedRate) / balance;
}
