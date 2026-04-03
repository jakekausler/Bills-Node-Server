import { v4 as uuidv4 } from 'uuid';
import { load, save } from './io';

// ─── RMD ──────────────────────────────────────────────────────

const RMD_FILE = 'rmd.json';

// Shape: { "73": 26.5, "74": 25.5, ... }
export type RMDTable = Record<string, number>;

export function loadRMDTable(): RMDTable {
  return load<RMDTable>(RMD_FILE);
}

export function saveRMDTable(table: RMDTable): void {
  save(table, RMD_FILE);
}

// ─── Roth Conversion ──────────────────────────────────────────

const ROTH_FILE = 'rothConversionConfig.json';

export interface RothConversionConfigData {
  id: string;
  enabled: boolean;
  sourceAccount: string;
  destinationAccount: string;
  startDateVariable: string;
  endDateVariable: string;
  strategy: 'fillBracket' | 'percentOfBracket';
  targetBracketRate: number;
  priority: 'largerFirst' | 'smallerFirst';
}

export function loadRothConversionConfigs(): RothConversionConfigData[] {
  try {
    const raw = load<Omit<RothConversionConfigData, 'id'>[]>(ROTH_FILE);
    let migrated = false;
    const configs = (raw || []).map((c) => {
      const config = c as RothConversionConfigData;
      if (!config.id) {
        config.id = uuidv4();
        migrated = true;
      }
      return config;
    });
    if (migrated) {
      save(configs, ROTH_FILE);
    }
    return configs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function saveRothConversionConfigs(configs: RothConversionConfigData[]): void {
  save(configs, ROTH_FILE);
}
