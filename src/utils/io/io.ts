import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import lockfile from 'proper-lockfile';

// Default data directory at repository root (CommonJS). Kept exported so existing
// test mocks (`vi.mock('./io', () => ({ BASE_DATA_DIR: '/mock/data' }))`) continue
// to work. Production code should call getDataDir() instead of reading this directly.
export const BASE_DATA_DIR = path.join(__dirname, '../../../data');

/**
 * Returns the active data directory, honoring BILLS_DATA_DIR when set.
 *
 * Lazy: re-read on every call so test harnesses can set the env var inside
 * `beforeEach` and have it take effect without module-reload gymnastics.
 *
 * All I/O call sites MUST go through this function. Reading BASE_DATA_DIR
 * directly bypasses the override.
 */
export function getDataDir(): string {
  return process.env.BILLS_DATA_DIR ?? BASE_DATA_DIR;
}

/**
 * Validates that a file path is within the active data directory to prevent path traversal attacks.
 * @param fn - Filename to validate
 * @returns Resolved path if valid
 * @throws Error if path traversal is attempted
 */
function safePath(fn: string): string {
  const dataDir = getDataDir();
  const resolved = path.resolve(dataDir, fn);
  if (!resolved.startsWith(path.resolve(dataDir))) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

/**
 * Loads and parses JSON data from a file
 * @template T - The expected type of the loaded data
 * @param fn - Filename relative to the data directory
 * @returns Parsed data object of type T
 * @throws Error if file cannot be read or parsed
 */
export function load<T>(fn: string): T {
  const data = readFileSync(safePath(fn), 'utf8');
  return JSON.parse(data) as T;
}

const SAVES_BEFORE_BACKUP = 10;
const MAX_BACKUPS = 10;
let saveCounter: Record<string, number> = {};

/**
 * Creates a backup copy of a file with timestamp
 * Automatically manages backup rotation to keep only MAX_BACKUPS files
 * @param fn - Filename to backup
 */
export const backup = (fn: string) => {
  const backupDir = path.join(getDataDir(), 'backup');
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir);
  }
  const backups = readdirSync(backupDir).filter((f) => f.startsWith(fn + '.'));
  while (backups.length >= MAX_BACKUPS) {
    unlinkSync(path.join(backupDir, backups.shift()!));
  }
  copyFileSync(safePath(fn), path.join(backupDir, `${fn}.${Date.now()}`));
};

/**
 * Determines if a file should be backed up based on save counter
 * @param fn - Filename to check
 * @returns True if backup should be created, false otherwise
 */
export const shouldBackup = (fn: string) => {
  if (!saveCounter[fn]) {
    saveCounter[fn] = 0;
  }
  saveCounter[fn]++;
  if (saveCounter[fn] >= SAVES_BEFORE_BACKUP) {
    saveCounter[fn] = 0;
    return true;
  }
  return false;
};

/**
 * Saves data to a JSON file with automatic backup rotation
 * @template T - Type of data being saved
 * @param data - Data object to save
 * @param fn - Filename relative to data directory
 */
export function save<T>(data: T, fn: string) {
  if (shouldBackup(fn)) {
    backup(fn);
  }
  const filePath = safePath(fn);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '{}');
  }
  const release = lockfile.lockSync(filePath, { realpath: false });
  try {
    writeFileSync(filePath, JSON.stringify(data, null, 2));
  } finally {
    release();
  }
}

/**
 * Checks if a file exists in the data directory
 * @param fn - Filename to check
 * @returns True if file exists, false otherwise
 */
export function checkExists(fn: string) {
  return existsSync(safePath(fn));
}
