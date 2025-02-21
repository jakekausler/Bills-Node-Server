export type InvestmentAccountsData = {
  accounts: InvestmentAccountData[];
};

export type InvestmentAccountData = {
  id: string;
  name: string;
  cashTarget: number;
  cashBalance: number;
  cashExpectedGrowth: number;
  shares: Share[];
  targets: Target[];
  activity: InvestmentActivityData[];
};

export type Share = {
  symbol: string;
  shares: number;
  expectedGrowth: number;
};

export type Target = {
  symbol: string;
  nonCashPortfolioTarget: number;
  isCustomFund: boolean;
  customMakeup: CustomFundMakeup[];
};

export type CustomFundMakeup = {
  symbol: string;
  makeup: number;
};

export type InvestmentActivityData = {
  id?: string;
  date: string;
  type: string;
  symbol: string;
  shares: number;
  price: number;
  newShares: number;
  usesCash: boolean;
  memo: string;
};
