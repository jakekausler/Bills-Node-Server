import { createHash, randomUUID } from 'crypto';
import { PortfolioTransaction } from '../calculate-v3/portfolio-types';

type TransactionType = PortfolioTransaction['type'];
type TransactionSource = PortfolioTransaction['source'];

/**
 * Parses a Fidelity account history CSV file and returns portfolio transactions.
 * Handles:
 * - UTF-8 BOM at file start
 * - Multiple blank/header lines before actual CSV header
 * - Footer disclaimer lines
 * - Quoted fields with commas inside quotes
 * - Currency formatting ($ signs, commas)
 * - Action type mapping to transaction types and sources
 */
export function parseFidelityCsv(fileContent: string, accountId: string): PortfolioTransaction[] {
  // Remove UTF-8 BOM if present
  let content = fileContent;
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const lines = content.split('\n');
  let headerIndex = -1;

  // Find the header row (starts with "Run Date")
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('Run Date')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error('CSV header row not found. Expected row starting with "Run Date"');
  }

  // Parse header to get column indices
  const headerLine = lines[headerIndex];
  const headers = parseCSVLine(headerLine);
  const columnMap = createColumnMap(headers);

  const transactions: PortfolioTransaction[] = [];

  // Process data rows starting after header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();

    // Stop at footer disclaimer lines
    if (isFooterLine(line)) {
      break;
    }

    // Skip empty lines
    if (!line) {
      continue;
    }

    try {
      const fields = parseCSVLine(line);

      // Only process if we have enough fields
      if (fields.length < Object.keys(columnMap).length) {
        continue;
      }

      const transaction = parseDataRow(fields, columnMap, accountId);
      if (transaction) {
        transactions.push(transaction);
      }
    } catch (error) {
      // Skip malformed rows
      continue;
    }
  }

  return transactions;
}

/**
 * Maps header column names to their indices
 */
function createColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const expectedColumns = [
    'Run Date',
    'Account',
    'Account Number',
    'Action',
    'Symbol',
    'Description',
    'Type',
    'Price ($)',
    'Quantity',
    'Commission ($)',
    'Fees ($)',
    'Accrued Interest ($)',
    'Amount ($)',
    'Settlement Date',
  ];

  for (const col of expectedColumns) {
    const index = headers.indexOf(col);
    if (index === -1) {
      throw new Error(`Required column "${col}" not found in CSV header`);
    }
    map[col] = index;
  }

  return map;
}

/**
 * Checks if a line is part of the footer disclaimer section
 */
function isFooterLine(line: string): boolean {
  if (!line) return false;
  const lowerLine = line.toLowerCase();
  return (
    lowerLine.includes('brokerage services') ||
    lowerLine.includes('the data and information') ||
    lowerLine.includes('informational purposes only') ||
    lowerLine.includes('recommendation for any security') ||
    lowerLine.includes('exported and is subject to change') ||
    lowerLine.includes('for more information on the data') ||
    lowerLine.includes('fidelity.com') ||
    lowerLine.includes('date downloaded') ||
    lowerLine.includes('national financial services') ||
    lowerLine.includes('fidelity insurance')
  );
}

/**
 * Parses a CSV line handling quoted fields and commas within quotes
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote within quoted field
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field delimiter
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add final field
  fields.push(current.trim());

  return fields;
}

/**
 * Parses a single data row into a PortfolioTransaction
 */
function parseDataRow(
  fields: string[],
  columnMap: Record<string, number>,
  accountId: string
): PortfolioTransaction | null {
  const getValue = (colName: string): string => {
    const index = columnMap[colName];
    return fields[index]?.trim() || '';
  };

  const runDate = getValue('Run Date');
  const account = getValue('Account');
  const accountNumber = getValue('Account Number');
  const action = getValue('Action');
  const symbol = getValue('Symbol') || 'CASH';
  const price = parsePrice(getValue('Price ($)'));
  const quantity = parseNumber(getValue('Quantity'));
  const commission = parsePrice(getValue('Commission ($)'));
  const fees = parsePrice(getValue('Fees ($)'));
  const accruedInterest = parsePrice(getValue('Accrued Interest ($)'));
  const amount = parsePrice(getValue('Amount ($)'));
  const settlementDate = getValue('Settlement Date');

  // Skip if no date
  if (!runDate) {
    return null;
  }

  const date = parseDate(runDate);
  const settlementDt = settlementDate ? parseDate(settlementDate) : date;

  // Determine transaction type and source from action
  const { type, source } = mapActionToTypeAndSource(action, amount);

  // Generate deterministic sourceId
  const sourceId = generateSourceId(accountNumber, date, action, symbol, quantity, amount);

  return {
    id: randomUUID(),
    accountId,
    fundSymbol: symbol,
    date,
    type,
    source,
    sourceId,
    shares: quantity,
    pricePerShare: price,
    totalAmount: amount,
    fees: fees + commission,
    memo: action,
    isProjected: false,
    isEstimated: false,
  };
}

/**
 * Maps Fidelity action text to transaction type and source
 */
function mapActionToTypeAndSource(action: string, amount: number): { type: TransactionType; source: TransactionSource } {
  const lowerAction = action.toLowerCase();

  // BUY actions
  if (lowerAction.includes('you bought') || lowerAction.includes('bought periodic')) {
    if (lowerAction.includes('transfer')) {
      return { type: 'buy', source: 'transfer' };
    }
    return { type: 'buy', source: 'contribution' };
  }

  // SELL actions
  if (lowerAction.includes('you sold') || lowerAction.includes('sold exchange') || lowerAction.includes('sold periodic')) {
    return { type: 'sell', source: 'manual' };
  }

  // REDEMPTION
  if (lowerAction.includes('redemption')) {
    return { type: 'sell', source: 'manual' };
  }

  // DIVIDEND and REINVESTMENT
  if (lowerAction.includes('dividend received')) {
    return { type: 'dividend', source: 'reinvestment' };
  }

  if (lowerAction.includes('reinvestment') || lowerAction.includes('reinvest')) {
    return { type: 'reinvest', source: 'reinvestment' };
  }

  // CAP GAINS
  if (lowerAction.includes('short-term cap gain') || lowerAction.includes('long-term cap gain')) {
    return { type: 'dividend', source: 'reinvestment' };
  }

  // ELECTRONIC FUNDS TRANSFER
  if (lowerAction.includes('electronic funds transfer')) {
    if (amount > 0) {
      return { type: 'transfer-in', source: 'transfer' };
    } else {
      return { type: 'transfer-out', source: 'transfer' };
    }
  }

  // TRANSFERRED FROM / TRANSFERRED TO
  if (lowerAction.includes('transferred from') || lowerAction.includes('transferred to')) {
    if (amount > 0) {
      return { type: 'buy', source: 'transfer' };
    } else {
      return { type: 'sell', source: 'transfer' };
    }
  }

  // Default: treat as buy
  return { type: 'buy', source: 'contribution' };
}

/**
 * Parses a date string in MM/DD/YYYY format to YYYY-MM-DD
 */
function parseDate(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const month = parts[0].padStart(2, '0');
  const day = parts[1].padStart(2, '0');
  const year = parts[2];
  return `${year}-${month}-${day}`;
}

/**
 * Parses a price string, removing $ and commas
 */
function parsePrice(priceStr: string): number {
  if (!priceStr || priceStr.trim() === '') {
    return 0;
  }
  const cleaned = priceStr.replace(/[$,]/g, '').trim();
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parses a numeric string
 */
function parseNumber(numStr: string): number {
  if (!numStr || numStr.trim() === '') {
    return 0;
  }
  const parsed = parseFloat(numStr.trim());
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Generates a deterministic sourceId using SHA256 hash
 */
function generateSourceId(
  accountNumber: string,
  date: string,
  action: string,
  symbol: string,
  quantity: number,
  amount: number
): string {
  const input = `${accountNumber}|${date}|${action}|${symbol}|${quantity}|${amount}`;
  const hash = createHash('sha256').update(input).digest('hex').substring(0, 16);
  return `fidelity:${hash}`;
}
