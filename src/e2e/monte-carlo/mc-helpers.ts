import { getAccountsAndTransfers } from '../../utils/io/accountsAndTransfers';
import { calculateAllActivity } from '../../utils/calculate-v3/engine';

export interface MCRunResult {
  accounts: any;
}

export async function runSingleMCSim(options: {
  seed: number;
  simulationNumber: number;
  totalSimulations: number;
  startDate: string;
  endDate: string;
  simulation?: string;
}): Promise<MCRunResult> {
  const simulation = options.simulation ?? 'Default';
  const data = getAccountsAndTransfers(simulation);

  // Derive per-simulation seed the same way the MC worker does
  const derivedSeed = (options.seed + options.simulationNumber * 2654435761) >>> 0;

  const result = await calculateAllActivity(
    data,
    new Date(options.startDate),
    new Date(options.endDate),
    simulation,
    true, // monteCarlo
    options.simulationNumber,
    options.totalSimulations,
    true, // forceRecalculation
    false, // enableLogging
    {}, // config
    undefined, // timeline
    derivedSeed,
  );

  return {
    accounts: result.accounts.map((a) => a.serialize(true)),
  };
}

export async function loadHistoricRates(): Promise<any> {
  const fs = await import('fs/promises');
  const path = await import('path');
  const dataDir = path.join(__dirname, '..', '..', '..', 'data');
  const content = await fs.readFile(path.join(dataDir, 'historicRates.json'), 'utf-8');
  return JSON.parse(content);
}
