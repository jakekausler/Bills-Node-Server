import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
export const BASE_DATA_DIR = path.join(dirname, 'data');

export function load<T>(fn: string): T {
  const data = readFileSync(path.join(BASE_DATA_DIR, fn), 'utf8');
  return JSON.parse(data) as T;
}

const SAVES_BEFORE_BACKUP = 10;
const BACKUP_DIR = path.join(BASE_DATA_DIR, 'backup');
const MAX_BACKUPS = 10;
let saveCounter: Record<string, number> = {};

export const backup = (fn: string) => {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR);
  }
  const backups = readdirSync(BACKUP_DIR).filter((f) => f.startsWith(fn));
  if (backups.length >= MAX_BACKUPS) {
    const oldest = backups.sort((a, b) => a.localeCompare(b))[0];
    unlinkSync(path.join(BACKUP_DIR, oldest));
  }
  copyFileSync(path.join(BASE_DATA_DIR, fn), path.join(BACKUP_DIR, `${fn}.${Date.now()}`));
};

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

export function save<T>(data: T, fn: string) {
  if (shouldBackup(fn)) {
    backup(fn);
  }
  writeFileSync(path.join(BASE_DATA_DIR, fn), JSON.stringify(data, null, 2));
}

export function checkExists(fn: string) {
  return existsSync(path.join(BASE_DATA_DIR, fn));
}
