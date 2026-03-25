import * as fs from 'fs';
import * as path from 'path';
import { PortfolioTransaction, AccountPortfolioConfig } from './portfolio-types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';

export interface AnchorPoint {
  accountId: string;
  cutoffDate: string;
  totalValue: number;
  costBasis: number;
  sharesByFund: Record<string, number>;
}

interface FundState {
  shares: number;
  totalCost: number;
}

/**
 * Pre-computes historical activities and anchor points for fund-level portfolio accounts.
 * Runs before the main calculation engine. Replays ledger transactions chronologically,
 * computing portfolio value at each transaction date using cached EOD prices.
 */
export class LedgerPrecomputer {
  private ledger: PortfolioTransaction[];
  private configs: Record<string, AccountPortfolioConfig>;
  private priceCache: Record<string, Record<string, number>>;

  constructor(
    ledger: PortfolioTransaction[],
    configs: Record<string, AccountPortfolioConfig>,
  ) {
    this.ledger = ledger;
    this.configs = configs;

    // Load price history cache synchronously for fast lookups
    const pricePath = path.join(__dirname, '../../../data/priceHistory.json');
    try {
      this.priceCache = JSON.parse(fs.readFileSync(pricePath, 'utf-8'));
    } catch {
      this.priceCache = {};
    }
  }

  /**
   * Pre-compute historical activities and anchor points for all fund-level accounts.
   */
  precompute(): {
    activities: Map<string, ConsolidatedActivity[]>;
    anchors: Map<string, AnchorPoint>;
  } {
    const activities = new Map<string, ConsolidatedActivity[]>();
    const anchors = new Map<string, AnchorPoint>();

    // Group ledger by accountId
    const byAccount = new Map<string, PortfolioTransaction[]>();
    for (const txn of this.ledger) {
      if (!txn.accountId) continue;
      const config = this.configs[txn.accountId];
      if (!config || config.mode !== 'fund-level') continue;

      if (!byAccount.has(txn.accountId)) {
        byAccount.set(txn.accountId, []);
      }
      byAccount.get(txn.accountId)!.push(txn);
    }

    for (const [accountId, txns] of byAccount) {
      const sorted = txns.sort((a, b) => a.date.localeCompare(b.date));
      const result = this.precomputeAccount(accountId, sorted);
      activities.set(accountId, result.activities);
      anchors.set(accountId, result.anchor);
    }

    return { activities, anchors };
  }

  private precomputeAccount(
    accountId: string,
    txns: PortfolioTransaction[],
  ): { activities: ConsolidatedActivity[]; anchor: AnchorPoint } {
    const fundStates: Record<string, FundState> = {};
    const activityList: ConsolidatedActivity[] = [];

    // Group transactions by date for batch processing
    const txnsByDate: Record<string, PortfolioTransaction[]> = {};
    for (const txn of txns) {
      if (!txnsByDate[txn.date]) txnsByDate[txn.date] = [];
      txnsByDate[txn.date].push(txn);
    }

    const sortedDates = Object.keys(txnsByDate).sort();

    for (const date of sortedDates) {
      const dateTxns = txnsByDate[date];

      // Process all transactions for this date
      for (const txn of dateTxns) {
        this.applyTransaction(fundStates, txn);

        // Create consolidated activity for this transaction
        const activity = this.createActivity(txn, date);
        if (activity) {
          activityList.push(activity);
        }
      }

      // Compute portfolio value at this date and set on ALL activities for this date
      const totalValue = this.computePortfolioValue(fundStates, date);
      for (let i = activityList.length - 1; i >= 0; i--) {
        if (activityList[i].balance === 0 || activityList[i].balance === totalValue) {
          activityList[i].balance = totalValue;
        } else {
          break; // Hit activities from a previous date that already have their balance
        }
      }
    }

    // Compute anchor point from final state
    const cutoffDate = sortedDates[sortedDates.length - 1] || '';
    const sharesByFund: Record<string, number> = {};
    let totalCost = 0;
    for (const [symbol, state] of Object.entries(fundStates)) {
      if (state.shares > 0.0001) {
        sharesByFund[symbol] = state.shares;
        totalCost += state.totalCost;
      }
    }

    const finalValue = cutoffDate
      ? this.computePortfolioValue(fundStates, cutoffDate)
      : 0;

    const anchor: AnchorPoint = {
      accountId,
      cutoffDate,
      totalValue: finalValue,
      costBasis: Math.round(totalCost * 100) / 100,
      sharesByFund,
    };

    return { activities: activityList, anchor };
  }

  private applyTransaction(fundStates: Record<string, FundState>, txn: PortfolioTransaction): void {
    const symbol = txn.fundSymbol;
    if (!symbol || symbol === 'CASH') return;

    if (!fundStates[symbol]) {
      fundStates[symbol] = { shares: 0, totalCost: 0 };
    }

    const state = fundStates[symbol];

    switch (txn.type) {
      case 'buy':
      case 'reinvest': {
        const shares = Math.abs(txn.shares);
        const cost = shares * txn.pricePerShare;
        state.shares += shares;
        state.totalCost += cost;
        break;
      }
      case 'sell': {
        const shares = Math.abs(txn.shares);
        if (state.shares > 0) {
          const costPerShare = state.totalCost / state.shares;
          state.shares -= shares;
          state.totalCost -= shares * costPerShare;
          if (state.shares < 0.0001) {
            state.shares = 0;
            state.totalCost = 0;
          }
        }
        break;
      }
      case 'fee': {
        // Fees are sells — reduce shares
        const shares = Math.abs(txn.shares);
        if (state.shares > 0 && shares > 0) {
          const costPerShare = state.totalCost / state.shares;
          state.shares -= shares;
          state.totalCost -= shares * costPerShare;
          if (state.shares < 0.0001) {
            state.shares = 0;
            state.totalCost = 0;
          }
        }
        break;
      }
      // dividend, transfer-in, transfer-out: don't change share counts
    }
  }

  private createActivity(txn: PortfolioTransaction, date: string): ConsolidatedActivity | null {
    // Map transaction type to activity type
    let investmentActivityType: 'buy' | 'sell' | 'dividend' | 'fee' | null = null;
    let name = txn.memo || txn.type;
    let category = 'Investment';

    switch (txn.type) {
      case 'buy':
        investmentActivityType = 'buy';
        name = txn.memo || `Buy ${txn.fundSymbol}`;
        category = 'Investment.Buy';
        break;
      case 'sell':
        investmentActivityType = 'sell';
        name = txn.memo || `Sell ${txn.fundSymbol}`;
        category = 'Investment.Sell';
        break;
      case 'reinvest':
        investmentActivityType = 'buy';
        name = txn.memo || `Reinvest ${txn.fundSymbol}`;
        category = 'Investment.Dividend';
        break;
      case 'dividend':
        investmentActivityType = 'dividend';
        name = txn.memo || `Dividend ${txn.fundSymbol}`;
        category = 'Investment.Dividend';
        break;
      case 'fee':
        investmentActivityType = 'fee';
        name = txn.memo || `Fee ${txn.fundSymbol}`;
        category = 'Investment.Fee';
        break;
      case 'transfer-in':
      case 'transfer-out':
        name = txn.memo || (txn.type === 'transfer-in' ? 'Transfer In' : 'Transfer Out');
        category = 'Ignore.Transfer';
        break;
      default:
        return null;
    }

    const activity = new ConsolidatedActivity({
      id: txn.id,
      date: date as `${number}-${number}-${number}`,
      dateIsVariable: false,
      dateVariable: null,
      name,
      category,
      amount: txn.totalAmount,
      amountIsVariable: false,
      amountVariable: null,
      flag: false,
      flagColor: null,
      isTransfer: txn.type === 'transfer-in' || txn.type === 'transfer-out',
      from: null,
      to: null,
      investmentActivityType,
      investmentActions: [{
        symbol: txn.fundSymbol,
        shares: txn.shares,
        pricePerShare: txn.pricePerShare,
        totalPrice: txn.totalAmount,
      }],
    });

    return activity;
  }

  private computePortfolioValue(
    fundStates: Record<string, FundState>,
    date: string,
  ): number {
    let total = 0;
    for (const [symbol, state] of Object.entries(fundStates)) {
      if (state.shares <= 0.0001) continue;
      const price = this.lookupPrice(symbol, date);
      total += state.shares * price;
    }
    return Math.round(total * 100) / 100;
  }

  private lookupPrice(symbol: string, date: string): number {
    const symbolPrices = this.priceCache[symbol];
    if (!symbolPrices) return 0;

    // Exact match
    if (symbolPrices[date] !== undefined) return symbolPrices[date];

    // Nearest date (find closest date that's <= target)
    const dates = Object.keys(symbolPrices).sort();
    let closest = '';
    for (const d of dates) {
      if (d <= date) closest = d;
      else break;
    }
    return closest ? symbolPrices[closest] : (dates.length > 0 ? symbolPrices[dates[0]] : 0);
  }
}
