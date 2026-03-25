#!/usr/bin/env node
/**
 * Pre-populates the price history cache by fetching EOD prices for all
 * tickers found in the portfolio ledger. Run this once to avoid slow
 * first-calculation fetching.
 *
 * Usage: node scripts/warm-price-cache.js
 */

const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(__dirname, '../data/portfolioLedger.json');
const PRICE_HISTORY_PATH = path.join(__dirname, '../data/priceHistory.json');

async function main() {
  console.log('Loading ledger...');
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  } catch {
    console.log('No ledger found at', LEDGER_PATH);
    return;
  }

  if (!Array.isArray(ledger) || ledger.length === 0) {
    console.log('Ledger is empty');
    return;
  }

  // Collect all unique symbols and date ranges
  const symbolDates = {};
  for (const txn of ledger) {
    if (!txn.fundSymbol || txn.fundSymbol === 'CASH') continue;
    if (!symbolDates[txn.fundSymbol]) {
      symbolDates[txn.fundSymbol] = { min: txn.date, max: txn.date, count: 0 };
    }
    const s = symbolDates[txn.fundSymbol];
    if (txn.date < s.min) s.min = txn.date;
    if (txn.date > s.max) s.max = txn.date;
    s.count++;
  }

  const symbols = Object.keys(symbolDates);
  console.log(`Found ${symbols.length} unique symbols across ${ledger.length} transactions`);

  // Load existing price cache
  let priceHistory = {};
  try {
    priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_PATH, 'utf8'));
  } catch {
    priceHistory = {};
  }

  // Count how many dates we already have cached per symbol
  let totalCached = 0;
  let totalNeeded = 0;
  for (const sym of symbols) {
    const cached = priceHistory[sym] ? Object.keys(priceHistory[sym]).length : 0;
    totalCached += cached;
    totalNeeded++;
  }
  console.log(`Price cache has ${totalCached} existing price points`);

  // Fetch historical prices for each symbol
  const YahooFinance = require('yahoo-finance2').default;
  const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

  let fetchedCount = 0;
  let errorCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    const { min, max, count } = symbolDates[symbol];

    // Check how many dates we already have for this symbol
    const existingDates = priceHistory[symbol] ? Object.keys(priceHistory[symbol]).length : 0;

    console.log(`[${i + 1}/${symbols.length}] ${symbol}: ${count} transactions, ${min} to ${max}, ${existingDates} cached prices`);

    if (existingDates > 100) {
      console.log(`  Skipping — already have ${existingDates} cached prices`);
      skippedCount++;
      continue;
    }

    try {
      // Fetch monthly historical data to get price anchors
      const startDate = new Date(min + 'T00:00:00Z');
      // Extend end date to include recent data
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 1);

      const history = await yf.historical(symbol, {
        period1: startDate,
        period2: endDate,
        interval: '1d',
      });

      if (!priceHistory[symbol]) priceHistory[symbol] = {};

      let newPrices = 0;
      for (const entry of history) {
        const d = entry.date.toISOString().substring(0, 10);
        if (!priceHistory[symbol][d]) {
          priceHistory[symbol][d] = entry.close;
          newPrices++;
        }
      }

      fetchedCount += newPrices;
      console.log(`  Fetched ${history.length} data points, ${newPrices} new prices cached`);

      // Save after each symbol to preserve progress
      fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(priceHistory, null, 2), 'utf8');

      // Rate limiting - wait 500ms between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      errorCount++;
    }
  }

  // Final save
  fs.writeFileSync(PRICE_HISTORY_PATH, JSON.stringify(priceHistory, null, 2), 'utf8');

  const totalPrices = Object.values(priceHistory).reduce((sum, dates) => sum + Object.keys(dates).length, 0);
  console.log('');
  console.log('=== Summary ===');
  console.log(`Symbols processed: ${symbols.length}`);
  console.log(`New prices fetched: ${fetchedCount}`);
  console.log(`Symbols skipped (already cached): ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Total cached prices: ${totalPrices}`);
  console.log(`Cache saved to: ${PRICE_HISTORY_PATH}`);
}

main().catch(console.error);
