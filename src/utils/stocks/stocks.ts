import yahooFinance from 'yahoo-finance2';
import { formatDate } from '../date/date';
import { ChartResultArray } from 'yahoo-finance2/dist/esm/src/modules/chart';
import { HISTORICAL_PRICES, setHistoricalPrices } from '../io/cache';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { BASE_DATA_DIR } from '../io/io';

export async function getHistory(symbol: string, from: Date, to: Date): Promise<ChartResultArray> {
  const key = `${formatDate(from)}-${formatDate(to)}`;
  const historicalPricesFile = join(BASE_DATA_DIR, `historical-prices-${key}-${symbol}.json`);
  // if (HISTORICAL_PRICES[key] && HISTORICAL_PRICES[key][symbol]) {
  //   return HISTORICAL_PRICES[key][symbol];
  // }
  if (existsSync(historicalPricesFile)) {
    const data = JSON.parse(readFileSync(historicalPricesFile, 'utf8'));
    return data;
  }
  const data = await yahooFinance.chart(symbol, {
    period1: formatDate(from),
    period2: formatDate(to),
  });
  // setHistoricalPrices(key, symbol, data);
  writeFileSync(historicalPricesFile, JSON.stringify(data));
  return data;
}

export async function getQuote(symbol: string) {
  const data = await yahooFinance.quoteSummary(symbol);
  return data;
}
