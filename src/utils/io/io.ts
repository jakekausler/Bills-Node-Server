import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';

// Point to data directory at repository root (CommonJS)
export const BASE_DATA_DIR = path.join(__dirname, '../../../data');

/**
 * Validates that a file path is within the BASE_DATA_DIR to prevent path traversal attacks
 * @param fn - Filename to validate
 * @returns Resolved path if valid
 * @throws Error if path traversal is attempted
 */
function safePath(fn: string): string {
  const resolved = path.resolve(BASE_DATA_DIR, fn);
  if (!resolved.startsWith(path.resolve(BASE_DATA_DIR))) {
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
const BACKUP_DIR = path.join(BASE_DATA_DIR, 'backup');
const MAX_BACKUPS = 10;
let saveCounter: Record<string, number> = {};

/**
 * Creates a backup copy of a file with timestamp
 * Automatically manages backup rotation to keep only MAX_BACKUPS files
 * @param fn - Filename to backup
 */
export const backup = (fn: string) => {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR);
  }
  const backups = readdirSync(BACKUP_DIR).filter((f) => f.startsWith(fn + '.'));
  while (backups.length >= MAX_BACKUPS) {
    unlinkSync(path.join(BACKUP_DIR, backups.shift()!));
  }
  copyFileSync(safePath(fn), path.join(BACKUP_DIR, `${fn}.${Date.now()}`));
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
  writeFileSync(safePath(fn), JSON.stringify(data, null, 2));
}

/**
 * Checks if a file exists in the data directory
 * @param fn - Filename to check
 * @returns True if file exists, false otherwise
 */
export function checkExists(fn: string) {
  return existsSync(safePath(fn));
}
