import { createHash } from 'crypto';
import { load, save, checkExists } from '../io/io';
import type { ImportMemory } from '../../api/import/types';

const IMPORT_MEMORY_FILE = 'importMemory.json';

/**
 * Loads import memory from file, creates with default structure if not exists
 */
export function loadImportMemory(): ImportMemory {
  try {
    return load<ImportMemory>(IMPORT_MEMORY_FILE);
  } catch (err) {
    // File doesn't exist or is invalid, return default
    const defaultMemory: ImportMemory = {
      formatMappings: {},
      transactionMappings: {},
      transferOverrides: {},
      importedFileHashes: [],
    };
    // Try to save it for next time
    try {
      saveImportMemory(defaultMemory);
    } catch (e) {
      // Ignore save errors during load
    }
    return defaultMemory;
  }
}

/**
 * Saves import memory to file
 */
export function saveImportMemory(memory: ImportMemory): void {
  save(memory, IMPORT_MEMORY_FILE);
}

/**
 * Computes SHA256 hash of alphabetically sorted headers joined with pipe
 */
export function computeHeaderHash(headers: string[]): string {
  const sorted = [...headers].sort();
  const joined = sorted.join('|');
  const hash = createHash('sha256').update(joined).digest('hex');
  return hash;
}

/**
 * Computes SHA256 hash of file content
 */
export function computeFileHash(content: string): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return hash;
}
