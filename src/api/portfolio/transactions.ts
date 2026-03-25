import { Request, Response } from 'express';
import { loadLedger, saveLedger } from '../../utils/io/portfolioLedger';
import { PortfolioTransaction } from '../../utils/calculate-v3/portfolio-types';
import { randomUUID } from 'crypto';

/**
 * Add a manual transaction to the portfolio ledger.
 */
export async function addTransaction(req: Request, res: Response) {
  try {
    const accountId = req.params.accountId;
    const data = req.body;

    const transaction: PortfolioTransaction = {
      id: randomUUID(),
      sourceId: `manual:${randomUUID()}`,
      accountId,
      memo: data.memo || '',
      date: data.date,
      type: data.type,
      fundSymbol: data.fundSymbol,
      shares: data.shares,
      pricePerShare: data.pricePerShare,
      totalAmount: data.totalAmount,
      fees: data.fees || 0,
      source: 'manual',
      isProjected: false,
      isEstimated: false,
    };

    const ledger = loadLedger();
    ledger.push(transaction);
    saveLedger(ledger);

    res.json({ id: transaction.id, success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * List transactions for an account.
 */
export async function listTransactions(req: Request, res: Response) {
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
 * Edit a transaction.
 */
export async function editTransaction(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const updates = req.body;
    const ledger = loadLedger();
    const idx = ledger.findIndex(t => t.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Merge updates (preserve id, sourceId, accountId)
    ledger[idx] = {
      ...ledger[idx],
      ...updates,
      id: ledger[idx].id,
      sourceId: ledger[idx].sourceId,
      accountId: ledger[idx].accountId,
    };

    saveLedger(ledger);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Delete a transaction.
 */
export async function deleteTransaction(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const ledger = loadLedger();
    const idx = ledger.findIndex(t => t.id === id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    ledger.splice(idx, 1);
    saveLedger(ledger);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
