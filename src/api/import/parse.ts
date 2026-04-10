import { Request, Response } from 'express';
import { parseCSV } from '../../utils/import/csvParser';
import { loadImportMemory } from '../../utils/import/importMemory';
import { computeHeaderHash, computeFileHash } from '../../utils/import/importMemory';
import type { ParseResponse } from './types';

/**
 * Parse a CSV file and return headers, rows, and metadata
 * Expects multipart/form-data with file field
 */
export async function parseStatement(req: Request, res: Response): Promise<void> {
  try {
    const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;

    if (!file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    // Check file extension
    if (!file.originalname.toLowerCase().endsWith('.csv')) {
      res.status(400).json({ error: 'Unsupported file type. Please upload a .csv file' });
      return;
    }

    // Read buffer as UTF-8
    const fileContent = file.buffer.toString('utf-8');

    // Parse CSV
    let headers: string[];
    let rows: string[][];
    let malformedRows: { line: number; content: string }[];

    try {
      const result = parseCSV(fileContent);
      headers = result.headers;
      rows = result.rows;
      malformedRows = result.malformedRows;
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    // Check if we have any valid rows
    if (rows.length === 0) {
      res.status(400).json({ error: 'No valid transactions found' });
      return;
    }

    // Compute hashes
    const headerHash = computeHeaderHash(headers);
    const fileHash = computeFileHash(fileContent);

    // Load import memory and check for duplicates
    const memory = loadImportMemory();
    const duplicateWarning = memory.importedFileHashes.includes(fileHash);

    const response: ParseResponse = {
      headers,
      rows,
      headerHash,
      malformedRows,
      duplicateWarning,
    };

    res.json(response);
  } catch (err) {
    console.error('Parse error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
