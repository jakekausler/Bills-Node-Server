import * as fs from 'fs';
import * as path from 'path';

const PRICE_HISTORY_PATH = path.join(__dirname, '../../../data/priceHistory.json');
const CURRENT_PRICES_PATH = path.join(__dirname, '../../../data/currentPrices.json');

// TTL for current prices: 24 hours in milliseconds
const CURRENT_PRICE_TTL = 24 * 60 * 60 * 1000;

type PriceHistoryData = Record<string, Record<string, number>>; // symbol → date → price
type CurrentPricesData = { fetchedAt: string; prices: Record<string, number> };

let priceHistoryCache: PriceHistoryData | null = null;
let currentPricesCache: CurrentPricesData | null = null;
let ledgerPriceIndex: PriceHistoryData = {};

/**
 * Build a price index from portfolio ledger transactions.
 * Call this once at startup with all ledger transactions.
 */
export function buildLedgerPriceIndex(transactions: Array<{ fundSymbol: string; date: string; pricePerShare: number }>): void {
  ledgerPriceIndex = {};
  for (const txn of transactions) {
    if (!txn.fundSymbol || !txn.date || !txn.pricePerShare || txn.pricePerShare <= 0) continue;
    if (!ledgerPriceIndex[txn.fundSymbol]) ledgerPriceIndex[txn.fundSymbol] = {};
    ledgerPriceIndex[txn.fundSymbol][txn.date] = txn.pricePerShare;
  }
}

function loadPriceHistory(): PriceHistoryData {
  if (priceHistoryCache) return priceHistoryCache;
  try {
    priceHistoryCache = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf-8'));
    return priceHistoryCache!;
  } catch {
    priceHistoryCache = {};
    return priceHistoryCache;
  }
}

function savePriceHistory(): void {
  if (!priceHistoryCache) return;
  fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(priceHistoryCache, null, 2), 'utf-8');
}

function loadCurrentPrices(): CurrentPricesData {
  if (currentPricesCache) return currentPricesCache;
  try {
    currentPricesCache = JSON.parse(fs.readFileSync(CURRENT_PRICES_PATH, 'utf-8'));
    return currentPricesCache!;
  } catch {
    currentPricesCache = { fetchedAt: '', prices: {} };
    return currentPricesCache;
  }
}

function saveCurrentPrices(): void {
  if (!currentPricesCache) return;
  fs.writeFileSync(CURRENT_PRICES_PATH, JSON.stringify(currentPricesCache, null, 2), 'utf-8');
}

function isCurrentPriceStale(): boolean {
  const data = loadCurrentPrices();
  if (!data.fetchedAt) return true;
  const fetchedAt = new Date(data.fetchedAt).getTime();
  return Date.now() - fetchedAt > CURRENT_PRICE_TTL;
}

/**
 * Fetch current price from Yahoo Finance API.
 * Returns null if API is unavailable.
 */
async function fetchCurrentPriceFromAPI(symbol: string): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const quote = await yf.quote(symbol);
    return quote?.regularMarketPrice ?? null;
  } catch (err) {
    console.warn(`[PriceService] Failed to fetch price for ${symbol}:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch historical price from Yahoo Finance API.
 */
async function fetchHistoricalPriceFromAPI(symbol: string, date: string): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
    const targetDate = new Date(date + 'T00:00:00Z');
    const nextDay = new Date(targetDate);
    nextDay.setDate(nextDay.getDate() + 5); // buffer for weekends/holidays
    const result = await yf.historical(symbol, {
      period1: targetDate,
      period2: nextDay,
      interval: '1d',
    });
    if (result && result.length > 0) {
      return result[0].close;
    }
    return null;
  } catch (err) {
    console.warn(`[PriceService] Failed to fetch historical price for ${symbol} on ${date}:`, (err as Error).message);
    return null;
  }
}

/**
 * Find nearest available price for a symbol from all cached sources.
 */
function findNearestPrice(symbol: string, date: string): number | null {
  const allPrices: Record<string, number> = {
    ...(ledgerPriceIndex[symbol] || {}),
    ...(loadPriceHistory()[symbol] || {}),
  };

  const dates = Object.keys(allPrices).sort();
  if (dates.length === 0) return null;

  // Binary search for nearest date
  let closest = dates[0];
  let minDiff = Math.abs(new Date(date).getTime() - new Date(closest).getTime());

  for (const d of dates) {
    const diff = Math.abs(new Date(date).getTime() - new Date(d).getTime());
    if (diff < minDiff) {
      minDiff = diff;
      closest = d;
    }
  }

  return allPrices[closest];
}

/**
 * Get price for a symbol on a specific date.
 * Priority: ledger index → price history cache → API fetch → nearest cached price.
 */
export async function getPrice(symbol: string, date: string): Promise<number | null> {
  // 1. Check ledger index
  if (ledgerPriceIndex[symbol]?.[date]) {
    return ledgerPriceIndex[symbol][date];
  }

  // 2. Check price history cache
  const history = loadPriceHistory();
  if (history[symbol]?.[date]) {
    return history[symbol][date];
  }

  // 3. Try API
  const apiPrice = await fetchHistoricalPriceFromAPI(symbol, date);
  if (apiPrice !== null) {
    // Cache it
    if (!history[symbol]) history[symbol] = {};
    history[symbol][date] = apiPrice;
    priceHistoryCache = history;
    savePriceHistory();
    return apiPrice;
  }

  // 4. Fallback: nearest cached price
  return findNearestPrice(symbol, date);
}

/**
 * Get current prices for multiple symbols.
 * Uses cached prices if fresh (< 24h), otherwise fetches from API.
 */
export async function getCurrentPrices(symbols: string[]): Promise<Record<string, number>> {
  const data = loadCurrentPrices();

  if (!isCurrentPriceStale() && symbols.every(s => s in data.prices)) {
    // All symbols cached and fresh
    const result: Record<string, number> = {};
    for (const s of symbols) {
      result[s] = data.prices[s];
    }
    return result;
  }

  // Fetch missing or stale prices
  await refreshPrices(symbols);

  const refreshed = loadCurrentPrices();
  const result: Record<string, number> = {};
  for (const s of symbols) {
    result[s] = refreshed.prices[s] ?? 0;
  }
  return result;
}

/**
 * Force refresh current prices for all given symbols from API.
 */
export async function refreshPrices(symbols: string[]): Promise<void> {
  const data = loadCurrentPrices();

  for (const symbol of symbols) {
    const price = await fetchCurrentPriceFromAPI(symbol);
    if (price !== null) {
      data.prices[symbol] = price;
    }
  }

  data.fetchedAt = new Date().toISOString();
  currentPricesCache = data;
  saveCurrentPrices();
}

/**
 * Get historical prices for a symbol over a date range.
 * Fetches from cache first, fills gaps from API.
 */
export async function getHistoricalPrices(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};

  // Gather from ledger index and history cache
  const sources = {
    ...(ledgerPriceIndex[symbol] || {}),
    ...(loadPriceHistory()[symbol] || {}),
  };

  for (const [date, price] of Object.entries(sources)) {
    if (date >= startDate && date <= endDate) {
      result[date] = price;
    }
  }

  // If we have sparse data, try bulk API fetch
  if (Object.keys(result).length === 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const YahooFinance = require('yahoo-finance2').default;
      const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });
      const history = await yf.historical(symbol, {
        period1: new Date(startDate + 'T00:00:00Z'),
        period2: new Date(endDate + 'T00:00:00Z'),
        interval: '1mo',
      });

      const priceHistory = loadPriceHistory();
      if (!priceHistory[symbol]) priceHistory[symbol] = {};

      for (const entry of history) {
        const d = entry.date.toISOString().substring(0, 10);
        result[d] = entry.close;
        priceHistory[symbol][d] = entry.close;
      }

      priceHistoryCache = priceHistory;
      savePriceHistory();
    } catch (err) {
      console.warn(`[PriceService] Failed to fetch historical prices for ${symbol}:`, (err as Error).message);
    }
  }

  return result;
}

/**
 * Clear all caches (useful for testing).
 */
export function clearCaches(): void {
  priceHistoryCache = null;
  currentPricesCache = null;
  ledgerPriceIndex = {};
}
