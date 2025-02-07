export type GraphData = YearlyGraphData | ActivityGraphData;

export type YearlyGraphData = {
  type: 'yearly';
  labels: string[];
  datasets: YearlyDataset[];
};

export type ActivityGraphData = {
  type: 'activity';
  labels: string[];
  datasets: ActivityDataset[];
};

export type Dataset = {
  label: string;
  data: number[];
};

export type YearlyDataset = Dataset;

export type ActivityDataset = Dataset & {
  activity: DailyActivity[];
};

export type DailyActivity = ActivityNameAndAmount[];

export type ActivityNameAndAmount = {
  name: string;
  amount: number;
};

// Keys of accounts
export type YearBalances = Record<string, YearBalance>;
// Keys of years
export type YearBalance = Record<number, MinMax | null>;
// Minimum and maximum balance for a year
export type MinMax = [number, number];
