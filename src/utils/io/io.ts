import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export const BASE_DATA_DIR = '/home/jakekausler/programs/billsV2/server-node/src/utils/io/data';

export function load<T>(fn: string): T {
  const data = readFileSync(path.join(BASE_DATA_DIR, fn), 'utf8');
  return JSON.parse(data) as T;
}

export function save<T>(data: T, fn: string) {
  writeFileSync(path.join(BASE_DATA_DIR, fn), JSON.stringify(data, null, 2));
}

export function checkExists(fn: string) {
  return existsSync(path.join(BASE_DATA_DIR, fn));
}
