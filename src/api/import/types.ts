export interface ColumnMapping {
  date: number;
  name: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
}

export interface FormatMapping {
  headers: string[];
  columnMapping: ColumnMapping;
  invertSigns: boolean;
  dateFormat: string;
}

export interface ImportMemory {
  formatMappings: Record<string, FormatMapping>;
  transactionMappings: Record<string, Record<string, unknown[]>>;
  transferOverrides: Record<string, Record<string, { from: string | null; to: string | null }>>;
  importedFileHashes: string[];
}

export interface ParseResponse {
  headers: string[];
  rows: string[][];
  headerHash: string;
  malformedRows: { line: number; content: string }[];
  duplicateWarning: boolean;
}
