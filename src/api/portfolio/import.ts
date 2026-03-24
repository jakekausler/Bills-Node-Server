import { Request, Response } from 'express';
import { parseQfx } from '../../utils/import/qfx-parser';
import { parseFidelityCsv } from '../../utils/import/csv-parser';
import { appendTransactions, loadLedger } from '../../utils/io/portfolioLedger';

/**
 * Import QFX file into portfolio ledger.
 * Expects raw file content in request body.
 */
export async function importQfx(req: Request, res: Response) {
  try {
    const accountId = req.query.accountId as string;
    if (!accountId) {
      return res.status(400).json({ error: 'accountId query parameter required' });
    }

    const fileContent = req.body;
    if (!fileContent || typeof fileContent !== 'string') {
      return res.status(400).json({ error: 'Request body must be raw QFX file content' });
    }

    const { transactions, positions } = parseQfx(fileContent, accountId);
    const result = appendTransactions(transactions);

    res.json({
      ...result,
      total: transactions.length,
      positions: positions.length,
    });
  } catch (err) {
    console.error('QFX import error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Import Fidelity CSV file into portfolio ledger.
 * Expects raw file content in request body.
 */
export async function importCsv(req: Request, res: Response) {
  try {
    const accountId = req.query.accountId as string;
    if (!accountId) {
      return res.status(400).json({ error: 'accountId query parameter required' });
    }

    const fileContent = req.body;
    if (!fileContent || typeof fileContent !== 'string') {
      return res.status(400).json({ error: 'Request body must be raw CSV file content' });
    }

    const transactions = parseFidelityCsv(fileContent, accountId);
    const result = appendTransactions(transactions);

    res.json({
      ...result,
      total: transactions.length,
    });
  } catch (err) {
    console.error('CSV import error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Get ledger transactions for a specific account.
 */
export async function getLedger(req: Request, res: Response) {
  try {
    const accountId = req.params.accountId;
    const ledger = loadLedger();
    const filtered = ledger.filter(t => t.accountId === accountId);
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Get current fund positions for a specific account.
 * This requires a calculation to have run (to initialize PortfolioManager).
 * As a fallback, reconstruct positions from the ledger.
 */
export async function getPositions(req: Request, res: Response) {
  try {
    const accountId = req.params.accountId;
    const ledger = loadLedger();
    const accountTxns = ledger
      .filter(t => t.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (accountTxns.length === 0) {
      return res.json({ accountId, positions: [], totalValue: 0, totalCost: 0 });
    }

    // Reconstruct positions using lot-like tracking
    const positions: Record<string, {
      symbol: string;
      shares: number;
      totalCost: number; // sum of (shares × price) for buys
      lastPrice: number; // most recent transaction price
    }> = {};

    for (const txn of accountTxns) {
      if (!txn.fundSymbol || txn.fundSymbol === 'CASH') continue;

      if (!positions[txn.fundSymbol]) {
        positions[txn.fundSymbol] = { symbol: txn.fundSymbol, shares: 0, totalCost: 0, lastPrice: txn.pricePerShare };
      }

      const pos = positions[txn.fundSymbol];
      pos.lastPrice = txn.pricePerShare; // always update to latest price

      switch (txn.type) {
        case 'buy':
        case 'reinvest': {
          const buyShares = Math.abs(txn.shares);
          const buyCost = buyShares * txn.pricePerShare;
          pos.shares += buyShares;
          pos.totalCost += buyCost;
          break;
        }
        case 'sell': {
          const sellShares = Math.abs(txn.shares);
          if (pos.shares > 0) {
            // Reduce cost basis proportionally
            const costPerShare = pos.totalCost / pos.shares;
            pos.shares -= sellShares;
            pos.totalCost -= sellShares * costPerShare;
            if (pos.shares < 0.0001) {
              pos.shares = 0;
              pos.totalCost = 0;
            }
          }
          break;
        }
      }
    }

    // Build response
    const result = Object.values(positions)
      .filter(p => p.shares > 0.0001)
      .map(p => ({
        symbol: p.symbol,
        shares: Math.round(p.shares * 10000) / 10000,
        avgCostPerShare: p.shares > 0 ? Math.round((p.totalCost / p.shares) * 100) / 100 : 0,
        totalCost: Math.round(p.totalCost * 100) / 100,
        lastPrice: Math.round(p.lastPrice * 100) / 100,
        currentValue: Math.round(p.shares * p.lastPrice * 100) / 100,
        unrealizedGain: Math.round((p.shares * p.lastPrice - p.totalCost) * 100) / 100,
      }))
      .sort((a, b) => b.currentValue - a.currentValue);

    const totalCost = result.reduce((sum, p) => sum + p.totalCost, 0);
    const totalValue = result.reduce((sum, p) => sum + p.currentValue, 0);

    res.json({
      accountId,
      positions: result,
      totalCost: Math.round(totalCost * 100) / 100,
      totalValue: Math.round(totalValue * 100) / 100,
      unrealizedGain: Math.round((totalValue - totalCost) * 100) / 100,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
