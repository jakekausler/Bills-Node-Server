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
    const accountTxns = ledger.filter(t => t.accountId === accountId);

    if (accountTxns.length === 0) {
      return res.json({ accountId, positions: [], totalValue: 0 });
    }

    // Reconstruct positions from ledger transactions
    const positions: Record<string, { symbol: string; shares: number; totalCost: number }> = {};

    for (const txn of accountTxns) {
      if (!txn.fundSymbol || txn.fundSymbol === 'CASH') continue;

      if (!positions[txn.fundSymbol]) {
        positions[txn.fundSymbol] = { symbol: txn.fundSymbol, shares: 0, totalCost: 0 };
      }

      switch (txn.type) {
        case 'buy':
        case 'reinvest':
          positions[txn.fundSymbol].shares += Math.abs(txn.shares);
          positions[txn.fundSymbol].totalCost += Math.abs(txn.totalAmount);
          break;
        case 'sell':
          positions[txn.fundSymbol].shares -= Math.abs(txn.shares);
          // Don't reduce totalCost on sell (cost basis stays)
          break;
      }
    }

    // Build response with current positions (shares > 0)
    const result = Object.values(positions)
      .filter(p => p.shares > 0.0001)
      .map(p => ({
        symbol: p.symbol,
        shares: Math.round(p.shares * 10000) / 10000,
        avgCostPerShare: p.totalCost / p.shares,
        totalCost: Math.round(p.totalCost * 100) / 100,
        // Note: currentPrice and currentValue would need PriceService lookup
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    res.json({
      accountId,
      positions: result,
      totalCost: result.reduce((sum, p) => sum + p.totalCost, 0),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
