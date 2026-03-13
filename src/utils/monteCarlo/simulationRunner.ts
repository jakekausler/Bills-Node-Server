import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getAccountsAndTransfers, loadData } from '../io/accountsAndTransfers';
import { AccountsAndTransfers } from '../../data/account/types';
import { SimulationJob, SimulationProgress, SimulationResult, FilteredActivity, FilteredAccount } from './types';
import { formatDate } from '../date/date';
import { generateMonteCarloStatisticsGraph } from './statisticsGraph';
import { Timeline } from '../calculate-v3/timeline';
import { minDate } from '../io/minDate';
import { calculateAllActivity } from '../calculate-v3/engine';
import { MC_TEMP_DIR, MC_RESULTS_DIR, MC_GRAPHS_DIR } from './paths';

export class MonteCarloSimulationRunner {
  private static instance: MonteCarloSimulationRunner;
  private jobs: Map<string, SimulationJob> = new Map();

  private constructor() {
    // Ensure directories exist
    if (!existsSync(MC_TEMP_DIR)) {
      mkdirSync(MC_TEMP_DIR, { recursive: true });
    }
    if (!existsSync(MC_RESULTS_DIR)) {
      mkdirSync(MC_RESULTS_DIR, { recursive: true });
    }
    if (!existsSync(MC_GRAPHS_DIR)) {
      mkdirSync(MC_GRAPHS_DIR, { recursive: true });
    }
  }

  public static async getInstance(): Promise<MonteCarloSimulationRunner> {
    if (!MonteCarloSimulationRunner.instance) {
      MonteCarloSimulationRunner.instance = new MonteCarloSimulationRunner();
      await MonteCarloSimulationRunner.instance.reconcileOnStartup();
    }
    return MonteCarloSimulationRunner.instance;
  }

  private async reconcileOnStartup(): Promise<void> {
    try {
      // Ensure all directories exist
      if (!existsSync(MC_TEMP_DIR)) {
        mkdirSync(MC_TEMP_DIR, { recursive: true });
      }
      if (!existsSync(MC_RESULTS_DIR)) {
        mkdirSync(MC_RESULTS_DIR, { recursive: true });
      }
      if (!existsSync(MC_GRAPHS_DIR)) {
        mkdirSync(MC_GRAPHS_DIR, { recursive: true });
      }

      // Clean all temp files
      if (existsSync(MC_TEMP_DIR)) {
        const tempFiles = readdirSync(MC_TEMP_DIR);
        for (const file of tempFiles) {
          try {
            unlinkSync(join(MC_TEMP_DIR, file));
          } catch (error) {
            console.warn(`⚠️ Failed to delete temp file ${file}:`, error);
          }
        }
      }

      // Scan results directory for completed simulations
      if (existsSync(MC_RESULTS_DIR)) {
        const resultFiles = readdirSync(MC_RESULTS_DIR).filter((file) => file.endsWith('.json'));

        for (const file of resultFiles) {
          const id = file.replace('.json', '');
          const resultFilePath = join(MC_RESULTS_DIR, file);

          try {
            // Parse the result file and check metadata
            const resultData = JSON.parse(readFileSync(resultFilePath, 'utf8'));
            if (!resultData.metadata) {
              console.warn(`⚠️ Result file ${id} missing metadata, skipping`);
              continue;
            }

            const completedAt = new Date(resultData.metadata.completedAt);
            const now = new Date();
            const ageInDays = (now.getTime() - completedAt.getTime()) / (1000 * 60 * 60 * 24);

            // Delete if older than 7 days
            if (ageInDays > 7) {
              console.log(`🗑️ Deleting expired simulation ${id} (${Math.floor(ageInDays)} days old)`);
              unlinkSync(resultFilePath);
              const graphFilePath = join(MC_GRAPHS_DIR, `${id}.json`);
              if (existsSync(graphFilePath)) {
                unlinkSync(graphFilePath);
              }
              continue;
            }

            // Check if graph file exists
            const graphFilePath = join(MC_GRAPHS_DIR, `${id}.json`);
            if (!existsSync(graphFilePath)) {
              console.log(`📈 Regenerating missing graph for simulation ${id}...`);
              try {
                const graphData = await generateMonteCarloStatisticsGraph(id, {
                  percentiles: [0, 5, 25, 50, 75, 95, 100],
                  includeDeterministic: true,
                  combineAccounts: true,
                });
                writeFileSync(graphFilePath, JSON.stringify(graphData, null, 2));
                console.log(`✅ Graph regenerated for simulation ${id}`);
              } catch (error) {
                console.error(`❌ Failed to regenerate graph for simulation ${id}:`, error);
                // Delete result if graph generation fails
                unlinkSync(resultFilePath);
                continue;
              }
            }

            // Both files exist and not expired - add to in-memory map
            const job: SimulationJob = {
              id,
              accountsAndTransfers: {} as AccountsAndTransfers,
              totalSimulations: resultData.metadata.totalSimulations,
              batchSize: 0,
              status: 'completed',
              progress: 100,
              completedSimulations: resultData.metadata.totalSimulations,
              createdAt: new Date(resultData.metadata.createdAt),
              tempFiles: [],
              startDate: new Date(resultData.metadata.startDate),
              endDate: new Date(resultData.metadata.endDate),
              startedAt: resultData.metadata.startedAt ? new Date(resultData.metadata.startedAt) : undefined,
              completedAt: new Date(resultData.metadata.completedAt),
              duration: resultData.metadata.duration,
            };
            this.jobs.set(id, job);
            console.log(`✅ Loaded completed simulation ${id} from disk`);
          } catch (error) {
            console.warn(`⚠️ Failed to reconcile simulation ${id}:`, error);
          }
        }
      }

      console.log(`🔄 Monte Carlo reconciliation complete. Loaded ${this.jobs.size} completed simulations.`);
    } catch (error) {
      console.error('❌ Fatal error during Monte Carlo reconciliation:', error);
      // Don't throw - allow server to start even if reconciliation fails
    }
  }

  public startSimulation(
    accountsAndTransfers: AccountsAndTransfers,
    totalSimulations: number,
    batchSize: number = 5,
    startDate: Date,
    endDate: Date,
  ): string {
    const id = uuidv4();

    const job: SimulationJob = {
      id,
      accountsAndTransfers,
      totalSimulations,
      batchSize,
      status: 'pending',
      progress: 0,
      completedSimulations: 0,
      createdAt: new Date(),
      tempFiles: [],
      startDate,
      endDate,
    };

    this.jobs.set(id, job);

    // Start the simulation in the background
    // Use setImmediate to ensure this runs after the current operation completes
    setImmediate(() => {
      this.runSimulationInBackground(id).catch((error) => {
        console.error(`❌ Failed to run simulation ${id} in background:`, error);
        job.status = 'error';
        job.error = error instanceof Error ? error.message : 'Unknown error';
      });
    });

    return id;
  }

  public getProgress(id: string): SimulationProgress | null {
    const job = this.jobs.get(id);
    if (!job) {
      return null;
    }

    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      completedSimulations: job.completedSimulations,
      totalSimulations: job.totalSimulations,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      startDate: formatDate(job.startDate),
      endDate: formatDate(job.endDate),
      duration: job.duration,
    };
  }

  public isComplete(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) {
      // This is an existing simulation that is not in the jobs map
      return true;
    }
    return job?.status === 'completed' || false;
  }

  public getResultFilePath(id: string): string | null {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'completed') {
      return null;
    }
    return join(MC_RESULTS_DIR, `${id}.json`);
  }

  public getAllSimulations(): SimulationProgress[] {
    // After reconciliation, all simulations are already in the jobs Map
    const allSimulations = Array.from(this.jobs.values()).map((job) => ({
      id: job.id,
      status: job.status,
      progress: job.progress,
      completedSimulations: job.completedSimulations,
      totalSimulations: job.totalSimulations,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      startDate: formatDate(job.startDate),
      endDate: formatDate(job.endDate),
      duration: job.duration,
      error: job.error,
    }));

    // Sort by creation date, most recent first
    return allSimulations.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  private async runSimulationInBackground(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;

    try {
      job.status = 'running';
      job.startedAt = new Date();

      console.log(
        `🚀 [${new Date().toISOString()}] Starting Monte Carlo simulation ${id} with ${job.totalSimulations} simulations...`,
      );

      // Run simulations in batches
      const batches = Math.ceil(job.totalSimulations / job.batchSize);

      // Initialize shared timeline
      const accountsAndTransfers = getAccountsAndTransfers('Default');
      const actualStartDate = minDate(accountsAndTransfers);
      const timeline = await Timeline.fromAccountsAndTransfers(
        accountsAndTransfers,
        actualStartDate,
        job.endDate,
        Date.now(),
        false,
        null,
        {
          startDate: job.startDate,
          endDate: job.endDate,
          simulation: 'Default',
          monteCarlo: true,
          simulationNumber: 0,
          totalSimulations: 0,
          forceRecalculation: false,
          enableLogging: false,
          config: {},
        },
      );

      for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
        const batchStart = batchIndex * job.batchSize + 1;
        const batchEnd = Math.min((batchIndex + 1) * job.batchSize, job.totalSimulations);

        await this.runBatch(job, batchStart, batchEnd, accountsAndTransfers, timeline);

        // Update progress
        job.completedSimulations = batchEnd;
        job.progress = (job.completedSimulations / job.totalSimulations) * 100;

        // Calculate elapsed time and ETA
        const now = new Date();
        const elapsedMs = job.startedAt ? now.getTime() - job.startedAt.getTime() : 0;
        const elapsedMinutes = Math.floor(elapsedMs / 60000);
        const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
        const elapsedFormatted = `${elapsedMinutes}m ${elapsedSeconds}s`;

        let etaFormatted = 'calculating...';
        if (job.progress > 0 && elapsedMs > 0) {
          const estimatedTotalTimeMs = (elapsedMs / job.progress) * 100;
          const remainingTimeMs = estimatedTotalTimeMs - elapsedMs;

          if (remainingTimeMs > 0) {
            const etaMinutes = Math.floor(remainingTimeMs / 60000);
            const etaSeconds = Math.floor((remainingTimeMs % 60000) / 1000);
            etaFormatted = `${etaMinutes}m ${etaSeconds}s`;
          } else {
            etaFormatted = 'completing soon...';
          }
        }

        console.log(
          `⭐ [${new Date().toISOString()}] Batch ${batchIndex + 1}/${batches} completed. Progress: ${job.progress.toFixed(1)}% | Elapsed: ${elapsedFormatted} | ETA: ${etaFormatted}`,
        );
      }

      job.status = 'completed';
      job.completedAt = new Date();
      job.progress = 100;

      // Calculate duration if startedAt is set
      if (job.startedAt) {
        job.duration = job.completedAt.getTime() - job.startedAt.getTime();
      }

      // Combine all temporary files into final result
      await this.combineTempFiles(job);

      // Generate and save graph data
      await this.generateAndSaveGraph(job);

      console.log(`🎉 [${new Date().toISOString()}] Monte Carlo simulation ${id} completed successfully`);
    } catch (error) {
      job.status = 'error';
      job.error = error instanceof Error ? error.message : 'Unknown error';
      job.completedAt = new Date();

      console.error(`❌ [${new Date().toISOString()}] Monte Carlo simulation ${id} failed:`, error);

      // Clean up temp files on error
      this.cleanupTempFiles(job);
    }
  }

  private async runBatch(
    job: SimulationJob,
    batchStart: number,
    batchEnd: number,
    accountsAndTransfers: AccountsAndTransfers,
    timeline: Timeline,
  ): Promise<void> {
    console.log(`🎲 [${new Date().toISOString()}] Running batch ${batchStart} to ${batchEnd}...`);
    const batchPromises: Promise<void>[] = [];

    for (let simNum = batchStart; simNum <= batchEnd; simNum++) {
      batchPromises.push(this.runSingleSimulation(job, simNum, accountsAndTransfers, timeline));
    }

    await Promise.all(batchPromises);
  }

  private async runSingleSimulation(
    job: SimulationJob,
    simulationNumber: number,
    accountsAndTransfers: AccountsAndTransfers,
    timeline: Timeline,
  ): Promise<void> {
    try {
      const results = await calculateAllActivity(
        accountsAndTransfers,
        job.startDate,
        job.endDate,
        'Default',
        true,
        simulationNumber,
        job.totalSimulations,
        false,
        false,
        {},
        timeline,
      );

      // Filter and format results
      const filteredResults: SimulationResult = {
        simulationNumber,
        accounts: results.accounts.map(
          (account): FilteredAccount => ({
            name: account.name,
            id: account.id,
            consolidatedActivity: account.consolidatedActivity.map((activity): FilteredActivity => {
              const serialized = activity.serialize();
              return {
                name: serialized.name,
                id: serialized.id,
                amount: typeof serialized.amount === 'number' ? serialized.amount : 0,
                balance: serialized.balance,
                from: serialized.from || '',
                to: serialized.to || '',
                date: serialized.date,
              };
            }),
          }),
        ),
      };

      // Write to temporary file
      const tempFileName = `${job.id}_sim_${simulationNumber}.json`;
      const tempFilePath = join(MC_TEMP_DIR, tempFileName);

      writeFileSync(tempFilePath, JSON.stringify(filteredResults));
      job.tempFiles.push(tempFilePath);
    } catch (error) {
      console.error(`❌ Simulation ${simulationNumber} failed:`, error);
      throw error;
    }
  }

  private async combineTempFiles(job: SimulationJob): Promise<void> {
    try {
      const allResults: SimulationResult[] = [];

      // Read all temp files
      for (const tempFile of job.tempFiles) {
        if (existsSync(tempFile)) {
          const content = readFileSync(tempFile, 'utf-8');
          const result: SimulationResult = JSON.parse(content);
          allResults.push(result);
        }
      }

      // Sort by simulation number
      allResults.sort((a, b) => a.simulationNumber - b.simulationNumber);

      // Create the final result with metadata
      const finalResult = {
        metadata: {
          id: job.id,
          startDate: job.startDate,
          endDate: job.endDate,
          totalSimulations: job.totalSimulations,
          createdAt: job.createdAt.toISOString(),
          startedAt: job.startedAt?.toISOString(),
          completedAt: job.completedAt?.toISOString(),
          duration: job.duration,
        },
        results: allResults,
      };

      // Write combined result
      const finalFilePath = join(MC_RESULTS_DIR, `${job.id}.json`);
      writeFileSync(finalFilePath, JSON.stringify(finalResult, null, 2));

      // Clean up temp files
      this.cleanupTempFiles(job);

      console.log(
        `💾 [${new Date().toISOString()}] Combined ${allResults.length} simulation results into ${finalFilePath}`,
      );
    } catch (error) {
      console.error('❌ Error combining temp files:', error);
      throw error;
    }
  }

  private async generateAndSaveGraph(job: SimulationJob): Promise<void> {
    try {
      console.log(`📈 [${new Date().toISOString()}] Generating graph for simulation ${job.id}...`);

      // Generate the graph data (now async to support deterministic calculation)
      const graphData = await generateMonteCarloStatisticsGraph(job.id, {
        percentiles: [0, 5, 25, 50, 75, 95, 100],
        includeDeterministic: true,
        combineAccounts: true,
      });

      // Save graph data to file
      const graphFilePath = join(MC_GRAPHS_DIR, `${job.id}.json`);
      writeFileSync(graphFilePath, JSON.stringify(graphData, null, 2));

      console.log(`✅ [${new Date().toISOString()}] Graph saved for simulation ${job.id} at ${graphFilePath}`);
    } catch (error) {
      console.error(`❌ [${new Date().toISOString()}] Failed to generate graph for simulation ${job.id}:`, error);
      // Don't throw the error - graph generation failure shouldn't fail the entire simulation
    }
  }

  private cleanupTempFiles(job: SimulationJob): void {
    for (const tempFile of job.tempFiles) {
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to delete temp file ${tempFile}:`, error);
      }
    }
    job.tempFiles = [];
  }
}

// Export convenience functions
export async function startMonteCarloSimulation(
  accountsAndTransfers: AccountsAndTransfers,
  totalSimulations: number,
  batchSize: number = 5,
  startDate: Date,
  endDate: Date,
): Promise<string> {
  const runner = await MonteCarloSimulationRunner.getInstance();
  return runner.startSimulation(accountsAndTransfers, totalSimulations, batchSize, startDate, endDate);
}

export async function getSimulationProgress(id: string): Promise<SimulationProgress | null> {
  const runner = await MonteCarloSimulationRunner.getInstance();
  return runner.getProgress(id);
}

export async function isSimulationComplete(id: string): Promise<boolean> {
  const runner = await MonteCarloSimulationRunner.getInstance();
  return runner.isComplete(id);
}

export async function getSimulationResultPath(id: string): Promise<string | null> {
  const runner = await MonteCarloSimulationRunner.getInstance();
  return runner.getResultFilePath(id);
}
