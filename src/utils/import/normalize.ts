/**
 * Normalize a transaction name for memory lookup/storage.
 * Steps: trim → collapse multiple spaces → lowercase → remove punctuation
 *
 * NOTE: Identical implementation exists on client at
 * Bills-Client-V2/src/pages/importers/utils/normalize.ts
 * Both must stay in sync. See design spec Section 4 (Name Normalization).
 */
export function normalizeTransactionName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/[^\w\s]/g, '');
}
