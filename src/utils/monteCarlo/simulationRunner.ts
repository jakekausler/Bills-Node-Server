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

export class MonteCarloSimulationRunner {
  private static instance: MonteCarloSimulationRunner;
  private jobs: Map<string, SimulationJob> = new Map();
  private tempDir: string;
  private outputDir: string;
  private graphsDir: string;

  private constructor() {
    this.tempDir = join(__dirname, 'temp');
    this.outputDir = join(__dirname, 'results');
    this.graphsDir = join(__dirname, 'graphs');

    // Ensure directories exist
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true });
    }
    if (!existsSync(this.outputDir)) {
      mkdirSync(this.outputDir, { recursive: true });
    }
    if (!existsSync(this.graphsDir)) {
      mkdirSync(this.graphsDir, { recursive: true });
    }
  }

  public static getInstance(): MonteCarloSimulationRunner {
    if (!MonteCarloSimulationRunner.instance) {
      MonteCarloSimulationRunner.instance = new MonteCarloSimulationRunner();
    }
    return MonteCarloSimulationRunner.instance;
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
        job.status = 'failed';
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
    return join(this.outputDir, `${id}.json`);
  }

  public getAllSimulations(): SimulationProgress[] {
    const activeSimulations = Array.from(this.jobs.values()).map((job) => ({
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

    // Get historical simulations from results directory
    const historicalSimulations: SimulationProgress[] = [];
    if (existsSync(this.outputDir)) {
      const resultFiles = readdirSync(this.outputDir).filter((file) => file.endsWith('.json'));

      for (const file of resultFiles) {
        const id = file.replace('.json', '');

        // Skip if this simulation is already in active jobs
        if (this.jobs.has(id)) {
          continue;
        }

        try {
          const filePath = join(this.outputDir, file);
          const stats = statSync(filePath);
          const resultData = JSON.parse(readFileSync(filePath, 'utf8'));

          // Check if the file has the new format with metadata
          if (resultData.metadata) {
            historicalSimulations.push({
              id,
              status: 'completed' as const,
              progress: 100,
              completedSimulations: resultData.metadata.totalSimulations,
              totalSimulations: resultData.metadata.totalSimulations,
              createdAt: new Date(resultData.metadata.createdAt),
              startedAt: resultData.metadata.startedAt ? new Date(resultData.metadata.startedAt) : undefined,
              completedAt: resultData.metadata.completedAt ? new Date(resultData.metadata.completedAt) : undefined,
              startDate: formatDate(new Date(resultData.metadata.startDate)),
              endDate: formatDate(new Date(resultData.metadata.endDate)),
              duration: resultData.metadata.duration,
              error: undefined,
            });
          } else {
            // Legacy format - extract what we can
            const totalSimulations = Array.isArray(resultData) ? resultData.length : 0;

            historicalSimulations.push({
              id,
              status: 'completed' as const,
              progress: 100,
              completedSimulations: totalSimulations,
              totalSimulations,
              createdAt: stats.birthtime || stats.mtime,
              completedAt: stats.mtime,
            });
          }
        } catch (error) {
          console.warn(`⚠️ Could not read historical simulation ${id}:`, error);
        }
      }
    }

    return [...activeSimulations, ...historicalSimulations].sort(
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
      job.status = 'failed';
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
      const tempFilePath = join(this.tempDir, tempFileName);

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
      const finalFilePath = join(this.outputDir, `${job.id}.json`);
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
      const graphFilePath = join(this.graphsDir, `${job.id}.json`);
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
export function startMonteCarloSimulation(
  accountsAndTransfers: AccountsAndTransfers,
  totalSimulations: number,
  batchSize: number = 5,
  startDate: Date,
  endDate: Date,
): string {
  const runner = MonteCarloSimulationRunner.getInstance();
  return runner.startSimulation(accountsAndTransfers, totalSimulations, batchSize, startDate, endDate);
}

export function getSimulationProgress(id: string): SimulationProgress | null {
  const runner = MonteCarloSimulationRunner.getInstance();
  return runner.getProgress(id);
}

export function isSimulationComplete(id: string): boolean {
  const runner = MonteCarloSimulationRunner.getInstance();
  return runner.isComplete(id);
}

export function getSimulationResultPath(id: string): string | null {
  const runner = MonteCarloSimulationRunner.getInstance();
  return runner.getResultFilePath(id);
}
