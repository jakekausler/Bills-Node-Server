import { Request, Response } from 'express';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface FundMetadata {
  symbol: string;
  name: string | null;
  fundFamily: string | null;
  category: string | null;
  expenseRatio: number | null;
  lastSynced: string | null;
  assetAllocation: {
    stock: number;
    bond: number;
    cash: number;
    other: number;
    preferred?: number;
    convertible?: number;
  } | null;
  sectorWeightings: Record<string, number> | null;
  geographicBreakdown: {
    domestic: number;
    international: number;
  } | null;
  marketCapBreakdown: {
    large: number;
    mid: number;
    small: number;
  } | null;
}

function validateBreakdown(obj: unknown): Record<string, number> | null {
  if (!obj || typeof obj !== 'object') return null;
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof val === 'number' && val >= 0 && val <= 1) {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function getMetadataPath(): string {
  return join(process.cwd(), 'data', 'fundMetadata.json');
}

function loadFundMetadata(): Record<string, FundMetadata> {
  try {
    return JSON.parse(readFileSync(getMetadataPath(), 'utf-8'));
  } catch {
    return {};
  }
}

function saveFundMetadata(data: Record<string, FundMetadata>): void {
  writeFileSync(getMetadataPath(), JSON.stringify(data, null, 2));
}

/**
 * GET /api/portfolio/fund-metadata
 * Returns all fund metadata.
 */
export async function getFundMetadata(_req: Request, res: Response) {
  try {
    const metadata = loadFundMetadata();
    res.json(metadata);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * PUT /api/portfolio/fund-metadata/:symbol
 * Update a single fund's metadata (manual edit).
 */
export async function updateFundMetadata(req: Request, res: Response) {
  try {
    const { symbol } = req.params;

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol parameter required' });
    }

    const metadata = loadFundMetadata();
    const existing = metadata[symbol] || { symbol };

    // Validate and whitelist allowed fields
    const allowedFields: Partial<FundMetadata> = {};
    if (typeof req.body.name === 'string') allowedFields.name = req.body.name;
    if (typeof req.body.fundFamily === 'string') allowedFields.fundFamily = req.body.fundFamily;
    if (typeof req.body.category === 'string') allowedFields.category = req.body.category;
    if (typeof req.body.expenseRatio === 'number') allowedFields.expenseRatio = req.body.expenseRatio;
    if (req.body.assetAllocation) allowedFields.assetAllocation = validateBreakdown(req.body.assetAllocation) as FundMetadata['assetAllocation'];
    if (req.body.sectorWeightings) allowedFields.sectorWeightings = validateBreakdown(req.body.sectorWeightings);
    if (req.body.geographicBreakdown) allowedFields.geographicBreakdown = validateBreakdown(req.body.geographicBreakdown) as FundMetadata['geographicBreakdown'];
    if (req.body.marketCapBreakdown) allowedFields.marketCapBreakdown = validateBreakdown(req.body.marketCapBreakdown) as FundMetadata['marketCapBreakdown'];

    // Merge updates into existing entry
    metadata[symbol] = { ...existing, ...allowedFields, symbol, lastSynced: existing?.lastSynced ?? null } as FundMetadata;

    saveFundMetadata(metadata);
    res.json(metadata[symbol]);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
