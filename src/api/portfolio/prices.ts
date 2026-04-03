import { Request, Response } from 'express';
import { getPrice, getCurrentPrices, refreshPrices, getHistoricalPrices, clearCaches } from '../../utils/prices/price-service';

/**
 * Get price for a symbol at a specific date.
 */
export async function getPriceEndpoint(req: Request, res: Response) {
  try {
    const symbol = req.params.symbol;
    const date = req.query.date as string;
    if (!date) {
      return res.status(400).json({ error: 'date query parameter required' });
    }

    const price = await getPrice(symbol, date);
    if (price === null) {
      return res.status(404).json({ error: `No price found for ${symbol} on ${date}` });
    }

    res.json({ symbol, date, price });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Get all cached current prices.
 */
export async function getCurrentPricesEndpoint(req: Request, res: Response) {
  try {
    const symbols = (req.query.symbols as string)?.split(',') || [];
    const prices = await getCurrentPrices(symbols);
    res.json(prices);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Force refresh current prices for all active tickers.
 */
export async function refreshPricesEndpoint(req: Request, res: Response) {
  try {
    const symbols = req.body?.symbols || [];
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({ error: 'Request body must include symbols array' });
    }
    await refreshPrices(symbols);
    res.json({ success: true, refreshed: symbols.length });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Get price history for a symbol within a date range.
 * Merges priceHistory.json with priceOverrides.json (overrides take precedence).
 */
export async function getPriceHistoryEndpoint(req: Request, res: Response) {
  try {
    const symbol = req.params.symbol;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate query parameters required' });
    }

    const fs = await import('fs');
    const path = await import('path');
    const PRICE_OVERRIDES_PATH = path.join(__dirname, '../../../data/priceOverrides.json');

    // Get historical prices
    const prices = await getHistoricalPrices(symbol, startDate, endDate);

    // Get overrides
    let overrides: Record<string, Record<string, number>> = {};
    try {
      overrides = JSON.parse(fs.readFileSync(PRICE_OVERRIDES_PATH, 'utf-8'));
    } catch { /* empty */ }

    const symbolOverrides = overrides[symbol] || {};

    // Convert Record<string, number> to array with isOverride flag
    // Include both historical prices and overrides (even if no historical data exists)
    const filteredOverrides = Object.keys(symbolOverrides).filter(d => (!startDate || d >= startDate) && (!endDate || d <= endDate));
    const allDates = new Set([...Object.keys(prices), ...filteredOverrides]);
    const result = Array.from(allDates)
      .map((date) => {
        const isOverride = date in symbolOverrides;
        return {
          date,
          price: isOverride ? symbolOverrides[date] : prices[date],
          isOverride,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Manually override a price for a symbol on a specific date.
 * Writes to priceOverrides.json instead of priceHistory.json.
 */
export async function overridePriceEndpoint(req: Request, res: Response) {
  try {
    const { symbol, date, price } = req.body;
    if (!symbol || !date || price === undefined || price === null) {
      return res.status(400).json({ error: 'symbol, date, and price are required' });
    }
    if (typeof price !== 'number' || isNaN(price)) {
      return res.status(400).json({ error: 'Invalid price value' });
    }

    // Update priceOverrides.json
    const fs = await import('fs');
    const path = await import('path');
    const PRICE_OVERRIDES_PATH = path.join(__dirname, '../../../data/priceOverrides.json');

    let overrides: Record<string, Record<string, number>> = {};
    try {
      overrides = JSON.parse(fs.readFileSync(PRICE_OVERRIDES_PATH, 'utf-8'));
    } catch { /* empty */ }

    if (!overrides[symbol]) overrides[symbol] = {};
    overrides[symbol][date] = price;
    fs.writeFileSync(PRICE_OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf-8');

    // Clear in-memory caches so next read picks up changes
    clearCaches();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Delete a price override for a symbol on a specific date.
 */
export async function deletePriceOverrideEndpoint(req: Request, res: Response) {
  try {
    const { symbol, date } = req.body;
    if (!symbol || !date) {
      return res.status(400).json({ error: 'symbol and date are required' });
    }

    const fs = await import('fs');
    const path = await import('path');
    const PRICE_OVERRIDES_PATH = path.join(__dirname, '../../../data/priceOverrides.json');

    let overrides: Record<string, Record<string, number>> = {};
    try {
      overrides = JSON.parse(fs.readFileSync(PRICE_OVERRIDES_PATH, 'utf-8'));
    } catch { /* empty */ }

    if (overrides[symbol]) {
      delete overrides[symbol][date];
      // Clean up empty symbol entries
      if (Object.keys(overrides[symbol]).length === 0) {
        delete overrides[symbol];
      }
    }

    fs.writeFileSync(PRICE_OVERRIDES_PATH, JSON.stringify(overrides, null, 2), 'utf-8');

    // Clear in-memory caches so next read picks up changes
    clearCaches();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Get all price overrides for a specific symbol.
 */
export async function getPriceOverridesEndpoint(req: Request, res: Response) {
  try {
    const symbol = req.params.symbol;

    const fs = await import('fs');
    const path = await import('path');
    const PRICE_OVERRIDES_PATH = path.join(__dirname, '../../../data/priceOverrides.json');

    let overrides: Record<string, Record<string, number>> = {};
    try {
      overrides = JSON.parse(fs.readFileSync(PRICE_OVERRIDES_PATH, 'utf-8'));
    } catch { /* empty */ }

    const symbolOverrides = overrides[symbol] || {};
    // Convert to array and sort by date
    const result = Object.entries(symbolOverrides)
      .map(([date, price]) => ({ date, price }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
