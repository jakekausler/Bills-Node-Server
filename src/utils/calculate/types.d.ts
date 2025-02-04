export type InvestmentRates = {
  stock: number[];
  bond: number[];
  preferred:
    | number[]
    | {
        proxy: {
          stock: number;
          bond: number;
        };
      };
  convertible:
    | number[]
    | {
        proxy: {
          stock: number;
          bond: number;
        };
      };
  cash: number[] | { proxy: { stock: number; bond: number } };
  other:
    | number[]
    | {
        proxy: {
          stock: number;
          bond: number;
        };
      };
};

export type Rates = {
  inflation: number[];
  raise: number[];
  '401kLimitIncrease': number[];
  savings: {
    highYield: number[];
    lowYield: number[];
  };
  mortgageIncrease: number[];
  investment: InvestmentRates;
};

export type Portfolio = {
  [startYear: number]: {
    stock: number;
    bond: number;
    preferred: number;
    convertible: number;
    cash: number;
    other: number;
  };
};
