import { AccountsAndTransfers } from '../../data/account/types';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';

export interface SimulationJob {
  id: string;
  accountsAndTransfers: AccountsAndTransfers;
  totalSimulations: number;
  batchSize: number;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  completedSimulations: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  tempFiles: string[];
  startDate: Date;
  endDate: Date;
  duration?: number; // Duration in milliseconds
  seed: number; // Base seed for reproducible MC
}

export interface SimulationProgress {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress: number;
  completedSimulations: number;
  totalSimulations: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  startDate?: string;
  endDate?: string;
  duration?: number; // Duration in milliseconds
}

export interface FilteredActivity {
  name: string;
  id: string;
  amount: number;
  balance: number;
  from: string;
  to: string;
  date: string;
}

export interface FilteredAccount {
  name: string;
  id: string;
  consolidatedActivity: FilteredActivity[];
}

export interface SimulationResult {
  simulationNumber: number;
  accounts: FilteredAccount[];
}

export interface YearlyMinBalances {
  [year: number]: number; // Minimum balance for that year across all accounts
}

export interface YearlyAccountBalances {
  [year: number]: { [accountId: string]: number }; // Minimum balance for each account by year
}

export interface AggregatedSimulationResult {
  simulationNumber: number;
  yearlyMinBalances: YearlyMinBalances;
  yearlyAccountBalances?: YearlyAccountBalances;
  cumulativeInflation?: Record<number, number>; // year → cumulative inflation multiplier from start year
  fundingFailureYear?: number | null; // #9: First year a pull account dropped below minimumBalance (null = never failed)
  drawnYears?: number[]; // Historical years drawn by MC handler for deterministic verification
  yearlyFlows?: Record<string, YearlyFlowSummary>; // Flow aggregation data per year (income, expenses, transfers, etc.)
  deathDates?: Record<string, string | null>; // person → ISO date string or null if alive at end of simulation
  inheritance?: Array<{
    benefactorId: string;
    parentDeathDates: Record<string, string | null>;
    inheritancePaidDate: string | null;
    inheritanceAmount: number;
    blocked: boolean;
  }>;
  yearlyPortfolioReturns?: Record<number, number>;
  lifeInsurance?: Array<{
    policyId: string;
    payoutDate: string | null;
    payoutAmount: number;
    coverageActiveAtDeath: boolean;
  }>;
}

export type WorkerMessage =
  | { type: 'progress'; completedSimulations: number; total: number }
  | { type: 'complete' }
  | { type: 'error'; message: string };

export interface WorkerData {
  totalSimulations: number;
  batchSize: number;
  startDate: string; // ISO string
  endDate: string; // ISO string
  simulationId: string;
  simulation: string; // simulation name for data loading
  tempDir: string;
  resultsDir: string;
  graphsDir: string;
  seed: number; // Base seed for this MC run
  debugLogDir?: string; // Shared debug log directory (from DebugLogger)
  debugSims?: number[]; // Which simulation numbers to log (empty = no debug)
}
