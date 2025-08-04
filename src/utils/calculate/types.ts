/**
 * Type definitions for calculation utilities
 */

/**
 * RMD (Required Minimum Distribution) table type
 * Maps age to RMD divisor value
 */
export type RMDTableType = Record<number, number>;

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
  limitIncrease401k: number[];
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

export type SimulationResults = {
  [year: string]: {
    [account: string]: {
      type: string;
      results: number[];
    };
  };
};

export type PercentileData = {
  [year: string]: PercentileDataYearItem;
};

export type PercentileDataYearItem = {
  [account: string]: {
    median: number;
    lowerQuartile: number;
    upperQuartile: number;
    min: number;
    max: number;
    percentiles: number[];
  };
};

export type LineGraphDatasets = { label: string; data: number[]; borderColor: string; backgroundColor: string }[];

export type BarChartDataset = { label: string; data: number[]; backgroundColor: string };
