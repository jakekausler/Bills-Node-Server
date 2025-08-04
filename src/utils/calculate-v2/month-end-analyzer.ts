import { Account } from '../../data/account/account.js';
import { debug, log, warn } from './logger.js';

export interface BalanceViolation {
  type: 'minimum' | 'maximum';
  date: Date;
  actualBalance: number;
  requiredBalance: number;
  shortfall: number;
}

export interface BalanceAnalysis {
  accountId: string;
  month: Date;
  minimumBalance: number;
  minimumBalanceDate: Date;
  maximumBalance: number;
  maximumBalanceDate: Date;
  dailyBalances: Map<string, number>; // date string -> balance
  violations: BalanceViolation[];
}

export interface RequiredTransfer {
  type: 'push' | 'pull';
  fromAccount: Account;
  toAccount: Account;
  amount: number;
  insertDate: Date; // Beginning of month
  reason: string;
}

export class MonthEndAnalyzer {
  private dailyBalanceRecords: Map<string, Map<string, number>> = new Map(); // accountId -> dateString -> balance

  /**
   * Records a balance for a specific account on a specific date
   */
  recordBalance(accountId: string, date: Date, balance: number): void {
    const dateKey = date.toISOString().split('T')[0];

    if (!this.dailyBalanceRecords.has(accountId)) {
      this.dailyBalanceRecords.set(accountId, new Map());
    }

    const accountBalances = this.dailyBalanceRecords.get(accountId)!;
    accountBalances.set(dateKey, balance);
  }

  /**
   * Analyzes a month's worth of balance data for an account
   */
  analyzeMonth(account: Account, monthStart: Date, monthEnd: Date): BalanceAnalysis {
    debug('MonthEndAnalyzer.analyzeMonth', 'Analyzing month for account', {
      accountId: account.id,
      accountName: account.name,
      monthStart: monthStart.toISOString(),
      monthEnd: monthEnd.toISOString(),
    });

    const accountBalances = this.dailyBalanceRecords.get(account.id) || new Map();
    const dailyBalances = new Map<string, number>();
    const violations: BalanceViolation[] = [];

    let minimumBalance = Infinity;
    let minimumBalanceDate = monthStart;
    let maximumBalance = -Infinity;
    let maximumBalanceDate = monthStart;

    // Iterate through each day of the month
    const currentDate = new Date(monthStart);
    while (currentDate <= monthEnd) {
      const dateKey = currentDate.toISOString().split('T')[0];
      const balance = accountBalances.get(dateKey) || account.balance;

      dailyBalances.set(dateKey, balance);

      // Track min/max balances
      if (balance < minimumBalance) {
        minimumBalance = balance;
        minimumBalanceDate = new Date(currentDate);
      }
      if (balance > maximumBalance) {
        maximumBalance = balance;
        maximumBalanceDate = new Date(currentDate);
      }

      // Check for violations
      if (account.performsPulls && account.minimumBalance !== null && balance < account.minimumBalance) {
        violations.push({
          type: 'minimum',
          date: new Date(currentDate),
          actualBalance: balance,
          requiredBalance: account.minimumBalance,
          shortfall: account.minimumBalance - balance,
        });
      }

      // For pushes, we need to check if balance is above a certain threshold
      // The original code seems to handle this differently, so we'll need to understand the push logic better
      // For now, we'll skip maximum balance violations

      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const analysis: BalanceAnalysis = {
      accountId: account.id,
      month: monthStart,
      minimumBalance,
      minimumBalanceDate,
      maximumBalance,
      maximumBalanceDate,
      dailyBalances,
      violations,
    };

    if (violations.length > 0) {
      log('MonthEndAnalyzer.analyzeMonth', 'Found balance violations', {
        accountId: account.id,
        accountName: account.name,
        violationCount: violations.length,
        firstViolation: violations[0],
      });
    }

    return analysis;
  }

  determineRequiredTransfers(analysis: BalanceAnalysis, account: Account, allAccounts: Account[]): RequiredTransfer[] {
    debug('MonthEndAnalyzer.determineRequiredTransfers', 'Determining required transfers', {
      accountId: account.id,
      violationCount: analysis.violations.length,
    });

    const transfers: RequiredTransfer[] = [];

    if (analysis.violations.length === 0) {
      return transfers;
    }

    // Check if account performs pulls/pushes
    if (!account.performsPulls && !account.performsPushes) {
      return transfers;
    }

    // Group violations by type to find the maximum shortfall
    const minViolations = analysis.violations.filter((v) => v.type === 'minimum');
    const maxViolations = analysis.violations.filter((v) => v.type === 'maximum');

    // Handle minimum balance violations (need to pull money in)
    if (minViolations.length > 0) {
      const maxShortfall = Math.max(...minViolations.map((v) => v.shortfall));
      const pullFromAccounts = this.findPullAccounts(account, allAccounts);

      if (pullFromAccounts.length > 0) {
        // For now, pull from the first available account
        // TODO: Implement more sophisticated logic for choosing source accounts
        const sourceAccount = pullFromAccounts[0];

        transfers.push({
          type: 'pull',
          fromAccount: sourceAccount,
          toAccount: account,
          amount: maxShortfall,
          insertDate: analysis.month,
          reason: `Pull to maintain minimum balance of ${account.minimumBalance}`,
        });
      } else {
        warn('MonthEndAnalyzer.determineRequiredTransfers', 'No accounts available to pull from', {
          accountId: account.id,
          requiredAmount: maxShortfall,
        });
      }
    }

    // Handle maximum balance violations (need to push money out)
    // Note: The original system doesn't seem to have a maxBalance property
    // Pushes are triggered by different logic, so we'll skip this for now

    return transfers;
  }

  private findPullAccounts(targetAccount: Account, allAccounts: Account[]): Account[] {
    debug('MonthEndAnalyzer.findPullAccounts', 'Finding accounts to pull from', {
      targetAccountId: targetAccount.id,
    });

    // Sort accounts by pull priority
    const sortedAccounts = [...allAccounts].sort((a, b) => a.pullPriority - b.pullPriority);

    return sortedAccounts.filter((acc) => {
      // Don't pull from the same account
      if (acc.id === targetAccount.id) {
        return false;
      }

      // For now, we'll assume accounts with priority >= 0 are valid pull sources
      // In the real implementation, this would check the account's balance at the time
      if (acc.pullPriority < 0) {
        return false;
      }

      // TODO: Add more checks here:
      // - Check actual account balance at the relevant time
      // - Check if pulling would violate source account's minimum
      // - Consider tax implications for retirement accounts

      return true;
    });
  }

  private findPushAccounts(sourceAccount: Account, allAccounts: Account[]): Account[] {
    debug('MonthEndAnalyzer.findPushAccounts', 'Finding accounts to push to', {
      sourceAccountId: sourceAccount.id,
    });

    // If pushAccount is specified, use that
    if (sourceAccount.pushAccount) {
      const pushAccount = allAccounts.find((acc) => acc.id === sourceAccount.pushAccount);
      return pushAccount ? [pushAccount] : [];
    }

    // Otherwise, we might need to implement more logic
    return [];
  }

  /**
   * Clears recorded balances for a specific time period
   */
  clearBalanceRecords(startDate?: Date, endDate?: Date): void {
    if (!startDate && !endDate) {
      this.dailyBalanceRecords.clear();
      return;
    }

    if (startDate && endDate) {
      const startKey = startDate.toISOString().split('T')[0];
      const endKey = endDate.toISOString().split('T')[0];

      for (const [accountId, balances] of this.dailyBalanceRecords) {
        for (const dateKey of balances.keys()) {
          if (dateKey >= startKey && dateKey <= endKey) {
            balances.delete(dateKey);
          }
        }
      }
    }
  }
}
