import { AssetAllocation } from './portfolio-types';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { formatDate } from '../date/date';
import { v4 as uuidv4 } from 'uuid';

interface DividendResult {
  activities: ConsolidatedActivity[];
  qualifiedAmount: number;
  ordinaryAmount: number;
  totalAmount: number;
}

/**
 * Generates future dividend income events for portfolio accounts.
 * Dividends are computed from portfolio value × blended dividend yield,
 * split into quarterly events with qualified/ordinary tax classification.
 */
export class DividendGenerator {
  /**
   * Generate quarterly dividend activities for a year.
   * @param accountId - The portfolio account ID
   * @param year - The tax year
   * @param portfolioValue - Current portfolio value
   * @param allocation - Asset allocation for this year
   * @param dividendYields - Per-asset-class dividend yields
   * @param isTaxAdvantaged - Whether this is a 401k/IRA/HSA (skip tax reporting)
   * @returns Dividend activities and tax amounts
   */
  generateAnnualDividends(
    accountId: string,
    year: number,
    portfolioValue: number,
    allocation: AssetAllocation,
    dividendYields: Record<string, number>,
    isTaxAdvantaged: boolean,
  ): DividendResult {
    // Compute blended dividend yield
    let blendedYield = 0;
    for (const [assetClass, weight] of Object.entries(allocation)) {
      if (!weight) continue;
      blendedYield += weight * (dividendYields[assetClass] ?? 0);
    }

    const annualDividend = portfolioValue * blendedYield;
    if (annualDividend < 0.01) {
      return { activities: [], qualifiedAmount: 0, ordinaryAmount: 0, totalAmount: 0 };
    }

    const quarterlyDividend = annualDividend / 4;

    // Tax classification: stock portion is qualified, bond/cash is ordinary
    const stockWeight = (allocation.stock ?? 0) + (allocation.preferred ?? 0);
    const qualifiedRatio = stockWeight; // Stock dividends are qualified
    const ordinaryRatio = 1 - qualifiedRatio; // Everything else is ordinary

    const qualifiedAmount = annualDividend * qualifiedRatio;
    const ordinaryAmount = annualDividend * ordinaryRatio;

    // Generate 4 quarterly activities (Mar, Jun, Sep, Dec)
    const quarterMonths = [2, 5, 8, 11]; // 0-indexed months
    const activities: ConsolidatedActivity[] = [];

    for (const month of quarterMonths) {
      const date = new Date(Date.UTC(year, month, 15)); // 15th of each quarter month
      const dateStr = formatDate(date) as `${number}-${number}-${number}`;

      const activity = new ConsolidatedActivity({
        id: `dividend-${accountId}-${year}-${month}`,
        date: dateStr,
        dateIsVariable: false,
        dateVariable: null,
        name: isTaxAdvantaged ? 'Dividend (Tax-Deferred)' : 'Dividend',
        category: 'Investment.Dividend',
        amount: Math.round(quarterlyDividend * 100) / 100,
        amountIsVariable: false,
        amountVariable: null,
        flag: false,
        flagColor: null,
        isTransfer: false,
        from: null,
        to: null,
        investmentActivityType: 'dividend',
        investmentActions: [],
      });

      activities.push(activity);
    }

    return {
      activities,
      qualifiedAmount: Math.round(qualifiedAmount * 100) / 100,
      ordinaryAmount: Math.round(ordinaryAmount * 100) / 100,
      totalAmount: Math.round(annualDividend * 100) / 100,
    };
  }
}
