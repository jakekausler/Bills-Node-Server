import { Request, Response } from 'express';
import { getPrice, getCurrentPrices, refreshPrices } from '../../utils/prices/price-service';

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
