import { readFileSync, unlinkSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Worker } from 'worker_threads';
import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { AccountsAndTransfers } from '../../data/account/types';
import { SimulationJob, SimulationProgress, WorkerData, WorkerMessage } from './types';
import { formatDate } from '../date/date';
import { MC_TEMP_DIR, MC_RESULTS_DIR, MC_GRAPHS_DIR } from './paths';

export class MonteCarloSimulationRunner {
  private static instance: MonteCarloSimulationRunner;
  private jobs: Map<string, SimulationJob> = new Map();
  private activeWorker: Worker | null = null;
  private activeJobId: string | null = null;
  private pendingQueue: SimulationJob[] = [];
  private debugConfigs: Map<string, { debugLogDir?: string; debugSims?: number[] }> = new Map();

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
              // Clean up legacy graph file if it exists
              const graphFilePath = join(MC_GRAPHS_DIR, `${id}.json`);
              if (existsSync(graphFilePath)) {
                unlinkSync(graphFilePath);
              }
              continue;
            }

            // Clean up legacy graph file if it exists (graphs are now computed on-demand)
            const graphFilePath = join(MC_GRAPHS_DIR, `${id}.json`);
            if (existsSync(graphFilePath)) {
              unlinkSync(graphFilePath);
              console.log(`🗑️ Removed legacy graph file for simulation ${id}`);
            }

            // Results file exists and not expired - add to in-memory map
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
              seed: resultData.metadata.seed ?? 0,
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
    seed?: number,
    debugLogDir?: string,
    debugSims?: number[],
  ): string {
    const id = uuidv4();
    // Generate a random seed if not provided
    const jobSeed = seed !== undefined ? seed : randomInt(0, 2 ** 32);

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
      seed: jobSeed,
    };

    this.jobs.set(id, job);

    if (debugLogDir || debugSims) {
      this.debugConfigs.set(id, { debugLogDir, debugSims });
    }

    if (this.activeWorker) {
      this.pendingQueue.push(job);
    } else {
      this.startWorker(job);
    }

    return id;
  }

  private startWorker(job: SimulationJob): void {
    const debugConfig = this.debugConfigs.get(job.id);
    const wd: WorkerData = {
      totalSimulations: job.totalSimulations,
      batchSize: job.batchSize,
      startDate: job.startDate.toISOString(),
      endDate: job.endDate.toISOString(),
      simulationId: job.id,
      simulation: 'Default',
      tempDir: MC_TEMP_DIR,
      resultsDir: MC_RESULTS_DIR,
      graphsDir: MC_GRAPHS_DIR,
      seed: job.seed,
      debugLogDir: debugConfig?.debugLogDir,
      debugSims: debugConfig?.debugSims,
    };

    const workerPath = join(__dirname, 'worker.ts');
    const worker = new Worker(workerPath, {
      workerData: wd,
      execArgv: ['--require', 'tsx/cjs'],
    });

    this.activeWorker = worker;
    this.activeJobId = job.id;
    job.status = 'running';
    job.startedAt = new Date();

    worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'progress') {
        job.completedSimulations = msg.completedSimulations;
        job.progress = Math.round((msg.completedSimulations / job.totalSimulations) * 100);
      } else if (msg.type === 'complete') {
        job.status = 'completed';
        job.completedAt = new Date();
        job.duration =
          job.completedAt.getTime() - (job.startedAt?.getTime() ?? job.createdAt.getTime());
        job.progress = 100;

        // Save duration to results file
        const resultsPath = join(MC_RESULTS_DIR, `${job.id}.json`);
        if (existsSync(resultsPath)) {
          const resultsData = JSON.parse(readFileSync(resultsPath, 'utf-8'));
          resultsData.metadata.duration = job.duration;
          writeFileSync(resultsPath, JSON.stringify(resultsData));
        }

        this.activeWorker = null;
        this.activeJobId = null;
        this.processQueue();
      } else if (msg.type === 'error') {
        job.status = 'error';
        job.error = msg.message;
        this.activeWorker = null;
        this.activeJobId = null;
        this.processQueue();
      }
    });

    worker.on('error', (err) => {
      job.status = 'error';
      job.error = err.message;
      this.activeWorker = null;
      this.activeJobId = null;
      this.processQueue();
    });

    worker.on('exit', (code) => {
      if (code !== 0 && job.status === 'running') {
        job.status = 'error';
        job.error = `Worker exited with code ${code}`;
        this.activeWorker = null;
        this.activeJobId = null;
        this.processQueue();
      }
    });
  }

  private processQueue(): void {
    if (this.activeWorker || this.pendingQueue.length === 0) return;
    const nextJob = this.pendingQueue.shift()!;
    this.startWorker(nextJob);
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
      return false;
    }
    return job.status === 'completed';
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

  async cancelOrDelete(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;

    // If running AND this is the active job, terminate the worker
    if (job.status === 'running' && this.activeWorker && this.activeJobId === id) {
      await this.activeWorker.terminate();
      this.activeWorker = null;
      this.activeJobId = null;
    }

    // If pending, remove from queue
    this.pendingQueue = this.pendingQueue.filter(j => j.id !== id);

    // Clean up files
    const resultPath = join(MC_RESULTS_DIR, `${id}.json`);
    const graphPath = join(MC_GRAPHS_DIR, `${id}.json`);
    if (existsSync(resultPath)) unlinkSync(resultPath);
    if (existsSync(graphPath)) unlinkSync(graphPath);

    // Clean temp files
    for (const tempFile of (job.tempFiles || [])) {
      if (existsSync(tempFile)) unlinkSync(tempFile);
    }

    // Remove from memory
    this.jobs.delete(id);

    // Process queue in case a pending job can now run
    this.processQueue();

    return true;
  }
}

// Export convenience functions
export async function startMonteCarloSimulation(
  accountsAndTransfers: AccountsAndTransfers,
  totalSimulations: number,
  batchSize: number = 5,
  startDate: Date,
  endDate: Date,
  seed?: number,
  debugLogDir?: string,
  debugSims?: number[],
): Promise<string> {
  const runner = await MonteCarloSimulationRunner.getInstance();
  return runner.startSimulation(accountsAndTransfers, totalSimulations, batchSize, startDate, endDate, seed, debugLogDir, debugSims);
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
