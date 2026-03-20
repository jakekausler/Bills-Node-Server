import { join } from 'path';

export const MC_BASE_DIR = join(process.cwd(), 'data', 'monteCarlo');
export const MC_TEMP_DIR = join(MC_BASE_DIR, 'temp');
export const MC_RESULTS_DIR = join(MC_BASE_DIR, 'results');
export const MC_GRAPHS_DIR = join(MC_BASE_DIR, 'graphs');

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
