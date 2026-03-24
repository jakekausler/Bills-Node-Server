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
