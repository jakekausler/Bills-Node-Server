import { randomUUID } from 'crypto';
import { PortfolioTransaction } from '../calculate-v3/portfolio-types';

export interface ParseQfxResult {
  transactions: PortfolioTransaction[];
  positions: Array<{
    cusip: string;
    ticker: string;
    name: string;
    shares: number;
    unitPrice: number;
    marketValue: number;
  }>;
}

interface SecurityInfo {
  cusip: string;
  ticker: string;
  name: string;
}

interface RawTransaction {
  fitId: string;
  tradeDate: string;
  memo: string;
  cusip: string;
  units: number;
  unitPrice: number;
  total: number;
}

interface RawPosition {
  cusip: string;
  units: number;
  unitPrice: number;
  marketValue: number;
}

/**
 * Parse OFX/QFX investment file to extract portfolio transactions and positions.
 * OFX/QFX uses SGML-like format where tags don't always have closing tags.
 * Values are extracted from lines following the opening tags.
 *
 * @param fileContent Raw file content as string
 * @param accountId Account ID for transaction storage
 * @returns ParseQfxResult with parsed transactions and positions
 */
export function parseQfx(fileContent: string, accountId: string): ParseQfxResult {
  // Build CUSIP -> { ticker, name } map from SECLIST
  const securityMap = parseSECLIST(fileContent);

  // Parse all BUYMF and SELLMF transactions
  const transactions = parseTransactions(fileContent, securityMap, accountId);

  // Parse POSLIST for current positions
  const positions = parsePOSLIST(fileContent, securityMap);

  return {
    transactions,
    positions,
  };
}

/**
 * Extract SECLIST and build CUSIP -> security info map
 */
function parseSECLIST(fileContent: string): Map<string, SecurityInfo> {
  const map = new Map<string, SecurityInfo>();

  // Find SECLIST section
  const seclistMatch = fileContent.match(/<SECLIST>([\s\S]*?)<\/SECLIST>/);
  if (!seclistMatch) {
    return map;
  }

  const seclistContent = seclistMatch[1];

  // Extract each MFINFO block (mutual funds) or STOCKINFO (stocks)
  const fundMatches = seclistContent.matchAll(
    /<(?:MFINFO|STOCKINFO)>([\s\S]*?)(?=<\/(?:MFINFO|STOCKINFO)>|<(?:MFINFO|STOCKINFO)>)/g
  );

  for (const fundMatch of fundMatches) {
    const fundBlock = fundMatch[1];

    // Extract CUSIP
    const cusipMatch = fundBlock.match(/<UNIQUEID>([\w\d]+)<\/UNIQUEID>/);
    if (!cusipMatch) continue;
    const cusip = cusipMatch[1].trim();

    // Extract TICKER
    const tickerMatch = fundBlock.match(/<TICKER>([\w\d]+)<\/TICKER>/);
    const ticker = tickerMatch ? tickerMatch[1].trim() : '';

    // Extract SECNAME (security name)
    const nameMatch = fundBlock.match(/<SECNAME>(.*?)<\/SECNAME>/);
    const name = nameMatch ? decodeHtmlEntities(nameMatch[1].trim()) : '';

    if (cusip) {
      map.set(cusip, { cusip, ticker, name });
    }
  }

  return map;
}

/**
 * Parse all BUYMF and SELLMF transactions
 */
function parseTransactions(
  fileContent: string,
  securityMap: Map<string, SecurityInfo>,
  accountId: string
): PortfolioTransaction[] {
  const transactions: PortfolioTransaction[] = [];

  // Parse BUYMF (purchases)
  const buyMatches = fileContent.matchAll(/<BUYMF>([\s\S]*?)(?=<\/BUYMF>|<BUYMF>)/g);
  for (const match of buyMatches) {
    const tx = parseBuyTransaction(match[1], securityMap, accountId);
    if (tx) {
      transactions.push(tx);
    }
  }

  // Parse SELLMF (sales)
  const sellMatches = fileContent.matchAll(/<SELLMF>([\s\S]*?)(?=<\/SELLMF>|<SELLMF>)/g);
  for (const match of sellMatches) {
    const tx = parseSellTransaction(match[1], securityMap, accountId);
    if (tx) {
      transactions.push(tx);
    }
  }

  return transactions;
}

/**
 * Parse a single BUYMF transaction block
 */
function parseBuyTransaction(
  block: string,
  securityMap: Map<string, SecurityInfo>,
  accountId: string
): PortfolioTransaction | null {
  const raw = extractTransactionFields(block);
  if (!raw) {
    return null;
  }

  const security = securityMap.get(raw.cusip);
  if (!security) {
    return null;
  }

  // Determine transaction type and source based on memo
  const { type, source } = mapMemoToTypeAndSource(raw.memo);

  return {
    id: randomUUID(),
    sourceId: `goretire:${raw.fitId}`,
    accountId,
    memo: raw.memo,
    date: formatDate(raw.tradeDate),
    type,
    fundSymbol: security.ticker,
    shares: raw.units,
    pricePerShare: raw.unitPrice,
    totalAmount: raw.total,
    fees: 0,
    source,
    isProjected: false,
    isEstimated: false,
  };
}

/**
 * Parse a single SELLMF transaction block
 */
function parseSellTransaction(
  block: string,
  securityMap: Map<string, SecurityInfo>,
  accountId: string
): PortfolioTransaction | null {
  const raw = extractTransactionFields(block);
  if (!raw) {
    return null;
  }

  const security = securityMap.get(raw.cusip);
  if (!security) {
    return null;
  }

  // For sells: units will be negative, convert to positive
  const absUnits = Math.abs(raw.units);
  const { type, source } = mapMemoToTypeAndSource(raw.memo);

  return {
    id: randomUUID(),
    sourceId: `goretire:${raw.fitId}`,
    accountId,
    memo: raw.memo,
    date: formatDate(raw.tradeDate),
    type,
    fundSymbol: security.ticker,
    shares: absUnits,
    pricePerShare: raw.unitPrice,
    totalAmount: Math.abs(raw.total), // Make absolute for consistency
    fees: 0,
    source,
    isProjected: false,
    isEstimated: false,
  };
}

/**
 * Extract transaction fields from INVBUY or INVSELL block
 */
function extractTransactionFields(block: string): RawTransaction | null {
  // FITID
  const fitIdMatch = block.match(/<FITID>([\d]+)</);
  if (!fitIdMatch) return null;
  const fitId = fitIdMatch[1];

  // DTTRADE - date
  const tradeMatch = block.match(/<DTTRADE>([\d]+)/);
  if (!tradeMatch) return null;
  const tradeDate = tradeMatch[1];

  // MEMO
  const memoMatch = block.match(/<MEMO>(.*?)<\/MEMO>/);
  const memo = memoMatch ? memoMatch[1].trim() : '';

  // UNIQUEID (CUSIP)
  const cusipMatch = block.match(/<UNIQUEID>([\w\d]+)<\/UNIQUEID>/);
  if (!cusipMatch) return null;
  const cusip = cusipMatch[1].trim();

  // UNITS
  const unitsMatch = block.match(/<UNITS>(-?[\d.]+)</);
  if (!unitsMatch) return null;
  const units = parseFloat(unitsMatch[1]);

  // UNITPRICE
  const priceMatch = block.match(/<UNITPRICE>(-?[\d.]+)</);
  if (!priceMatch) return null;
  const unitPrice = parseFloat(priceMatch[1]);

  // TOTAL
  const totalMatch = block.match(/<TOTAL>(-?[\d.]+)</);
  if (!totalMatch) return null;
  const total = parseFloat(totalMatch[1]);

  return {
    fitId,
    tradeDate,
    memo,
    cusip,
    units,
    unitPrice,
    total,
  };
}

/**
 * Map MEMO text to transaction type and source
 */
function mapMemoToTypeAndSource(
  memo: string
): { type: PortfolioTransaction['type']; source: PortfolioTransaction['source'] } {
  const upperMemo = memo.toUpperCase();

  if (
    upperMemo.includes('EMPLOYEE PRE-TAX CONTRIBUTION') ||
    upperMemo.includes('EMPLOYER MATCHING CONTRIBUTION') ||
    upperMemo.includes('EMPLOYEE POST TAX CONTRIBUTION') ||
    upperMemo.includes('ROLLOVER CONTRIBUTION')
  ) {
    return { type: 'buy', source: 'contribution' };
  }

  if (upperMemo.includes('REINVESTED DIVIDEND')) {
    return { type: 'reinvest', source: 'reinvestment' };
  }

  if (upperMemo.includes('INCOME RECEIVED')) {
    return { type: 'dividend', source: 'reinvestment' };
  }

  if (upperMemo.includes('PURCHASE DUE TO FUND TRANSFER')) {
    return { type: 'buy', source: 'rebalance' };
  }

  if (upperMemo.includes('SALE DUE TO FUND TRANSFER')) {
    return { type: 'sell', source: 'rebalance' };
  }

  if (upperMemo.includes('ASSET ALLOCATION')) {
    // For ASSET ALLOCATION, the sign of units tells us buy vs sell
    // But we don't have access to units here, so we default to 'buy'
    // The caller must check the units field
    return { type: 'buy', source: 'rebalance' };
  }

  if (upperMemo.includes('TRUSTEE FEE')) {
    return { type: 'fee', source: 'manual' };
  }

  // Default: assume buy with contribution source
  return { type: 'buy', source: 'contribution' };
}

/**
 * Parse POSLIST for current positions
 */
function parsePOSLIST(
  fileContent: string,
  securityMap: Map<string, SecurityInfo>
): ParseQfxResult['positions'] {
  const positions: ParseQfxResult['positions'] = [];

  // Find POSLIST section
  const poslistMatch = fileContent.match(/<POSLIST>([\s\S]*?)(?=<\/POSLIST>|$)/);
  if (!poslistMatch) {
    return positions;
  }

  const poslistContent = poslistMatch[1];

  // Extract each POSMF block
  const posMatches = poslistContent.matchAll(/<POSMF>([\s\S]*?)(?=<\/POSMF>|<POSMF>)/g);

  for (const match of posMatches) {
    const posBlock = match[1];
    const pos = parsePositionFields(posBlock);

    if (pos) {
      const security = securityMap.get(pos.cusip);
      if (security) {
        positions.push({
          cusip: pos.cusip,
          ticker: security.ticker,
          name: security.name,
          shares: pos.units,
          unitPrice: pos.unitPrice,
          marketValue: pos.marketValue,
        });
      }
    }
  }

  return positions;
}

/**
 * Extract position fields from POSMF/INVPOS block
 */
function parsePositionFields(block: string): RawPosition | null {
  // CUSIP
  const cusipMatch = block.match(/<UNIQUEID>([\w\d]+)<\/UNIQUEID>/);
  if (!cusipMatch) return null;
  const cusip = cusipMatch[1].trim();

  // UNITS
  const unitsMatch = block.match(/<UNITS>(-?[\d.]+)</);
  if (!unitsMatch) return null;
  const units = parseFloat(unitsMatch[1]);

  // UNITPRICE
  const priceMatch = block.match(/<UNITPRICE>(-?[\d.]+)</);
  if (!priceMatch) return null;
  const unitPrice = parseFloat(priceMatch[1]);

  // MKTVAL (market value)
  const mktvalMatch = block.match(/<MKTVAL>(-?[\d.]+)</);
  if (!mktvalMatch) return null;
  const marketValue = parseFloat(mktvalMatch[1]);

  return {
    cusip,
    units,
    unitPrice,
    marketValue,
  };
}

/**
 * Convert YYYYMMDD format to YYYY-MM-DD format
 */
function formatDate(dateStr: string): string {
  if (!dateStr || dateStr.length < 8) {
    return '';
  }

  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);

  return `${year}-${month}-${day}`;
}

/**
 * Decode HTML entities (e.g., &amp; → &)
 */
function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }

  return decoded;
}
