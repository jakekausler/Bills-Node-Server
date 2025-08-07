import { AccountsAndTransfers } from '../../data/account/types';

export interface SimulationJob {
  id: string;
  accountsAndTransfers: AccountsAndTransfers;
  totalSimulations: number;
  batchSize: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
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
}

export interface SimulationProgress {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
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
