import { Request, Response } from 'express';
import { loadLedger, appendTransactions } from '../../utils/io/portfolioLedger';
import { PortfolioTransaction } from '../../utils/calculate-v3/portfolio-types';
import { randomUUID } from 'crypto';

interface HoldingInput {
  symbol: string;
  shares: number;
  costBasis?: number;
}

/**
 * Reconcile portfolio holdings against actual brokerage data.
 * Generates adjustment transactions to match tracked state to actual.
 */
export async function reconcileHoldings(req: Request, res: Response) {
  try {
    const accountId = req.params.accountId;
    const actualHoldings: HoldingInput[] = req.body.holdings;
    const date = req.body.date || new Date().toISOString().substring(0, 10);

    if (!actualHoldings || !Array.isArray(actualHoldings)) {
      return res.status(400).json({ error: 'holdings array required' });
    }

    // Reconstruct current tracked positions from ledger
    const ledger = loadLedger();
    const accountTxns = ledger.filter(t => t.accountId === accountId);
    const tracked: Record<string, number> = {};

    for (const txn of accountTxns) {
      if (!txn.fundSymbol || txn.fundSymbol === 'CASH') continue;
      if (!tracked[txn.fundSymbol]) tracked[txn.fundSymbol] = 0;
      switch (txn.type) {
        case 'buy':
        case 'reinvest':
          tracked[txn.fundSymbol] += Math.abs(txn.shares);
          break;
        case 'sell':
        case 'fee':
          tracked[txn.fundSymbol] -= Math.abs(txn.shares);
          break;
      }
    }

    // Compare and generate adjustments
    const adjustments: PortfolioTransaction[] = [];
    const report: Array<{ symbol: string; tracked: number; actual: number; adjustment: number }> = [];

    for (const holding of actualHoldings) {
      const trackedShares = tracked[holding.symbol] || 0;
      const diff = holding.shares - trackedShares;

      if (Math.abs(diff) > 0.0001) {
        const pricePerShare = holding.costBasis && holding.shares > 0
          ? holding.costBasis / holding.shares
          : 1;

        adjustments.push({
          id: randomUUID(),
          sourceId: `reconcile:${randomUUID()}`,
          accountId,
          memo: `Reconciliation adjustment for ${holding.symbol}`,
          date,
          type: diff > 0 ? 'buy' : 'sell',
          fundSymbol: holding.symbol,
          shares: diff,
          pricePerShare,
          totalAmount: Math.abs(diff) * pricePerShare,
          fees: 0,
          source: 'manual',
          isProjected: false,
          isEstimated: false,
        });

        report.push({
          symbol: holding.symbol,
          tracked: Math.round(trackedShares * 10000) / 10000,
          actual: holding.shares,
          adjustment: Math.round(diff * 10000) / 10000,
        });
      }

      // Remove from tracked so we can find positions we have but shouldn't
      delete tracked[holding.symbol];
    }

    // Any remaining tracked positions need to be zeroed out
    for (const [symbol, shares] of Object.entries(tracked)) {
      if (shares > 0.0001) {
        adjustments.push({
          id: randomUUID(),
          sourceId: `reconcile:${randomUUID()}`,
          accountId,
          memo: `Reconciliation: remove ${symbol} (not in actual holdings)`,
          date,
          type: 'sell',
          fundSymbol: symbol,
          shares: -shares,
          pricePerShare: 1,
          totalAmount: shares,
          fees: 0,
          source: 'manual',
          isProjected: false,
          isEstimated: false,
        });

        report.push({
          symbol,
          tracked: Math.round(shares * 10000) / 10000,
          actual: 0,
          adjustment: -Math.round(shares * 10000) / 10000,
        });
      }
    }

    // Apply adjustments
    if (adjustments.length > 0) {
      const result = appendTransactions(adjustments);
      res.json({
        adjustments: report,
        imported: result.imported,
        skipped: result.skipped,
      });
    } else {
      res.json({ adjustments: [], message: 'Holdings match — no adjustments needed' });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
