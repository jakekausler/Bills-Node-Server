import { Account } from '../../data/account/account';

export class AccountManager {
  private accountNameMap: Map<string, Account>;
  private accountIdMap: Map<string, Account>;
  private pullableAccounts: Account[];

  constructor(accounts: Account[]) {
    this.accountNameMap = new Map(accounts.map((account) => [account.name, account]));
    this.accountIdMap = new Map(accounts.map((account) => [account.id, account]));
    this.pullableAccounts = accounts.filter((a) => a.pullPriority !== -1);
  }

  getAccountByName(name: string): Account | undefined {
    return this.accountNameMap.get(name);
  }

  getAccountById(id: string): Account | undefined {
    return this.accountIdMap.get(id);
  }

  getPullableAccounts(): Account[] {
    return this.pullableAccounts;
  }
}
