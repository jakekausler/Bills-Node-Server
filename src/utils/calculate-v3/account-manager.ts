import { Account } from '../../data/account/account';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { loadPensionsAndSocialSecurity } from '../io/retirement';
import { CalculationOptions } from './types';

export class AccountManager {
  private accountNameMap: Map<string, Account>;
  private accountIdMap: Map<string, Account>;
  private interestPayAccountNames: Set<string>;
  private pullableAccounts: Account[];
  private socialSecurities: SocialSecurity[] = [];
  private pensions: Pension[] = [];

  constructor(accounts: Account[], options: CalculationOptions) {
    // Deep clone accounts to avoid mutations affecting other parallel calculations
    const clonedAccounts = accounts.map((account) => new Account(account.serialize()));
    this.accountNameMap = new Map(clonedAccounts.map((account) => [account.name, account]));
    this.accountIdMap = new Map(clonedAccounts.map((account) => [account.id, account]));
    this.pullableAccounts = clonedAccounts.filter((a) => a.pullPriority !== -1);
    const { socialSecurities, pensions } = loadPensionsAndSocialSecurity(options.simulation);
    this.socialSecurities = socialSecurities;
    this.pensions = pensions;

    this.interestPayAccountNames = new Set(
      clonedAccounts.map((a) => a.interestPayAccount).filter((name) => name !== null),
    );
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

  getSocialSecurities(): SocialSecurity[] {
    return this.socialSecurities;
  }

  getPensions(): Pension[] {
    return this.pensions;
  }

  getInterestPayAccountNames(): Set<string> {
    return this.interestPayAccountNames;
  }
}
