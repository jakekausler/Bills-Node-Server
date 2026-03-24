import * as fs from 'fs';
import * as path from 'path';
import { PortfolioTransaction } from '../calculate-v3/portfolio-types';

const LEDGER_PATH = path.join(__dirname, '../../../data/portfolioLedger.json');

/**
 * Load portfolio ledger transactions from disk.
 * Handles both array format and legacy empty object format.
 */
export function loadLedger(): PortfolioTransaction[] {
  try {
    const raw = fs.readFileSync(LEDGER_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    // Legacy: empty object {} or keyed object → return empty array
    return [];
  } catch {
    return [];
  }
}

/**
 * Save portfolio ledger transactions to disk, sorted by date.
 */
export function saveLedger(transactions: PortfolioTransaction[]): void {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(sorted, null, 2), 'utf-8');
}

/**
 * Append new transactions to the ledger, deduplicating by sourceId.
 * Returns count of imported and skipped transactions.
 */
export function appendTransactions(
  newTransactions: PortfolioTransaction[],
): { imported: number; skipped: number } {
  const existing = loadLedger();
  const existingSourceIds = new Set(
    existing.filter(t => t.sourceId).map(t => t.sourceId),
  );

  let imported = 0;
  let skipped = 0;

  for (const txn of newTransactions) {
    if (txn.sourceId && existingSourceIds.has(txn.sourceId)) {
      skipped++;
    } else {
      existing.push(txn);
      if (txn.sourceId) {
        existingSourceIds.add(txn.sourceId);
      }
      imported++;
    }
  }

  saveLedger(existing);
  return { imported, skipped };
}
