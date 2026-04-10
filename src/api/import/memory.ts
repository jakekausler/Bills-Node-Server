import { Request, Response } from 'express';
import { loadImportMemory, saveImportMemory } from '../../utils/import/importMemory';
import type { ImportMemory } from './types';

/**
 * Get import memory by headerHash or accountId
 * If no headerHash provided, returns entire memory (for UI management)
 */
export async function getImportMemory(req: Request, res: Response): Promise<void> {
  try {
    const headerHash = req.query.headerHash as string | undefined;
    const accountId = req.query.accountId as string | undefined;

    const memory = loadImportMemory();

    if (!headerHash) {
      // Return entire memory for management UI
      res.json(memory);
      return;
    }

    // Return specific format mapping and transaction mappings for this header hash
    const formatMapping = memory.formatMappings[headerHash];
    const transactionMappings = memory.transactionMappings[headerHash];
    const transferOverrides = accountId ? memory.transferOverrides[accountId] : undefined;

    res.json({
      formatMapping,
      transactionMappings,
      transferOverrides,
    });
  } catch (err) {
    console.error('Get import memory error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Update import memory with partial data
 * Deep merges formatMappings, transactionMappings, and transferOverrides at key level
 */
export async function updateImportMemory(req: Request, res: Response): Promise<void> {
  try {
    const partialMemory = req.body as Partial<ImportMemory>;

    const memory = loadImportMemory();

    // Deep merge formatMappings
    if (partialMemory.formatMappings) {
      memory.formatMappings = {
        ...memory.formatMappings,
        ...partialMemory.formatMappings,
      };
    }

    // Deep merge transactionMappings
    if (partialMemory.transactionMappings) {
      memory.transactionMappings = {
        ...memory.transactionMappings,
        ...partialMemory.transactionMappings,
      };
    }

    // Deep merge transferOverrides
    if (partialMemory.transferOverrides) {
      memory.transferOverrides = {
        ...memory.transferOverrides,
        ...partialMemory.transferOverrides,
      };
    }

    // Merge file hashes (avoiding duplicates)
    if (partialMemory.importedFileHashes) {
      const existing = new Set(memory.importedFileHashes);
      for (const hash of partialMemory.importedFileHashes) {
        existing.add(hash);
      }
      memory.importedFileHashes = Array.from(existing);
    }

    saveImportMemory(memory);

    res.json({ success: true });
  } catch (err) {
    console.error('Update import memory error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}

/**
 * Delete import memory entries
 * Supports:
 * - all=true: reset to default empty structure
 * - headerHash: delete format and transaction mappings for hash
 * - headerHash + name: delete specific transaction name mapping
 * - accountId + name: delete specific transfer override
 */
export async function deleteImportMemory(req: Request, res: Response): Promise<void> {
  try {
    const all = req.query.all === 'true';
    const headerHash = req.query.headerHash as string | undefined;
    const name = req.query.name as string | undefined;
    const accountId = req.query.accountId as string | undefined;

    const memory = loadImportMemory();

    if (all) {
      // Reset to default
      const defaultMemory: ImportMemory = {
        formatMappings: {},
        transactionMappings: {},
        transferOverrides: {},
        importedFileHashes: [],
      };
      saveImportMemory(defaultMemory);
      res.json({ success: true });
      return;
    }

    if (headerHash && name && !accountId) {
      // Delete specific transaction name mapping
      if (memory.transactionMappings[headerHash]) {
        delete memory.transactionMappings[headerHash][name];
      }
      saveImportMemory(memory);
      res.json({ success: true });
      return;
    }

    if (headerHash && !name && !accountId) {
      // Delete entire header hash's format and transaction mappings
      delete memory.formatMappings[headerHash];
      delete memory.transactionMappings[headerHash];
      saveImportMemory(memory);
      res.json({ success: true });
      return;
    }

    if (accountId && name && !headerHash) {
      // Delete specific transfer override
      if (memory.transferOverrides[accountId]) {
        delete memory.transferOverrides[accountId][name];
      }
      saveImportMemory(memory);
      res.json({ success: true });
      return;
    }

    res.status(400).json({ error: 'Invalid delete parameters' });
  } catch (err) {
    console.error('Delete import memory error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
