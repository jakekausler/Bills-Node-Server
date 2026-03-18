import { parentPort, workerData } from 'worker_threads';
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, createWriteStream } from 'fs';
import { join } from 'path';
import { getAccountsAndTransfers } from '../io/accountsAndTransfers';
import { WorkerData, WorkerMessage, SimulationResult, FilteredActivity, FilteredAccount, AggregatedSimulationResult } from './types';
import { Timeline } from '../calculate-v3/timeline';
import { minDate } from '../io/minDate';
import { calculateAllActivity, getLastPullFailures } from '../calculate-v3/engine';
import { generateMonteCarloStatisticsGraph, calculateYearlyMinBalances } from './statisticsGraph';
import { loadSpendingTrackerCategories } from '../io/spendingTracker';
import { MonteCarloHandler } from '../calculate-v3/monte-carlo-handler';
import { DebugLogger } from '../calculate-v3/debug-logger';

const data = workerData as WorkerData;
let accountNames: Array<{ id: string; name: string }> = [];

/**
 * Main worker execution function.
 * Runs Monte Carlo simulations in parallel within worker threads.
 */
async function runWorkerSimulations(): Promise<void> {
  try {
    // Log debug configuration if present
    if (data.debugLogDir || data.debugSims) {
      console.log(`🔍 [Worker] Debug config: dir=${data.debugLogDir}, sims=${JSON.stringify(data.debugSims)}`);
    }

    // Ensure directories exist
    if (!existsSync(data.tempDir)) {
      mkdirSync(data.tempDir, { recursive: true });
    }
    if (!existsSync(data.resultsDir)) {
      mkdirSync(data.resultsDir, { recursive: true });
    }
    if (!existsSync(data.graphsDir)) {
      mkdirSync(data.graphsDir, { recursive: true });
    }

    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);
    const totalSimulations = data.totalSimulations;
    const batchSize = data.batchSize;

    console.log(
      `🚀 [Worker] Starting Monte Carlo simulations: ${totalSimulations} total, batch size: ${batchSize}`,
    );

    // Load accounts and transfers from disk (can't serialize class instances through worker_threads)
    const accountsAndTransfers = getAccountsAndTransfers(data.simulation);
    const actualStartDate = minDate(accountsAndTransfers);

    // Load spending tracker categories
    const spendingTrackerCategories = loadSpendingTrackerCategories();

    // Create shared timeline (same as runner does)
    const timeline = await Timeline.fromAccountsAndTransfers(
      accountsAndTransfers,
      actualStartDate,
      endDate,
      Date.now(),
      false,
      null,
      {
        startDate,
        endDate,
        simulation: data.simulation,
        monteCarlo: true,
        simulationNumber: 0,
        totalSimulations: 0,
        forceRecalculation: false,
        enableLogging: false,
        config: {},
      },
      spendingTrackerCategories,
    );

    // Run simulations in batches
    const batches = Math.ceil(totalSimulations / batchSize);
    const tempFiles: string[] = [];

    for (let batchIndex = 0; batchIndex < batches; batchIndex++) {
      const batchStart = batchIndex * batchSize + 1;
      const batchEnd = Math.min((batchIndex + 1) * batchSize, totalSimulations);

      // Run all simulations in batch in parallel
      const batchPromises: Promise<void>[] = [];
      for (let simNum = batchStart; simNum <= batchEnd; simNum++) {
        // Derive per-simulation seed from base seed with better mixing
        // Multiply by large prime to ensure seeds are far apart in seed space
        const simSeed = data.seed + simNum * 2654435761;
        batchPromises.push(
          runSingleSimulation(
            simNum,
            totalSimulations,
            startDate,
            endDate,
            accountsAndTransfers,
            timeline,
            tempFiles,
            simSeed,
          ),
        );
      }

      await Promise.all(batchPromises);

      // Send progress update after each batch
      if (parentPort) {
        const message: WorkerMessage = {
          type: 'progress',
          completedSimulations: batchEnd,
          total: totalSimulations,
        };
        parentPort.postMessage(message);
      }

      console.log(`⭐ [Worker] Batch ${batchIndex + 1}/${batches} completed. Progress: ${batchEnd}/${totalSimulations}`);
    }

    // Combine temp files into final result
    await combineTempFiles(tempFiles, startDate, endDate, accountNames);

    // Generate and save graph
    await generateAndSaveGraph();

    // Send complete message
    if (parentPort) {
      const message: WorkerMessage = { type: 'complete' };
      parentPort.postMessage(message);
    }

    console.log(`🎉 [Worker] All simulations completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`❌ [Worker] Fatal error:`, error);

    if (parentPort) {
      const message: WorkerMessage = {
        type: 'error',
        message: errorMessage,
      };
      parentPort.postMessage(message);
    }

    throw error;
  }
}

/**
 * Run a single Monte Carlo simulation
 */
async function runSingleSimulation(
  simulationNumber: number,
  totalSimulations: number,
  startDate: Date,
  endDate: Date,
  accountsAndTransfers: any,
  timeline: Timeline,
  tempFiles: string[],
  seed: number,
): Promise<void> {
  try {
    // Create debug logger for this sim if it's in the debugSims list
    let debugLogger: DebugLogger | null = null;
    if (data.debugLogDir && data.debugSims && data.debugSims.includes(simulationNumber)) {
      debugLogger = new DebugLogger({ dir: data.debugLogDir, debugSims: data.debugSims });
      console.log(`🔍 [Worker] Created debug logger for sim ${simulationNumber} → ${data.debugLogDir}`);
    }

    const results = await calculateAllActivity(
      accountsAndTransfers,
      startDate,
      endDate,
      data.simulation,
      true, // monteCarlo: true
      simulationNumber,
      totalSimulations,
      false,
      false,
      {}, // config
      timeline, // timeline
      seed, // seed for seeded PRNG
      debugLogger, // debug logger for selected sims
    );

    // Filter and format results for balance calculation
    const filteredAccounts: FilteredAccount[] = results.accounts.map(
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
    );

    // Capture account names on first simulation
    if (simulationNumber === 1 && accountNames.length === 0) {
      accountNames = results.accounts.map(acc => ({ id: acc.id, name: acc.name }));
    }

    // Calculate yearly minimum balances
    const balanceData = calculateYearlyMinBalances(filteredAccounts, true);

    // #9: Check for funding failure using actual pull failures from the engine
    // A pull failure occurs when the push/pull handler couldn't source enough funds
    const pullFailures = getLastPullFailures();
    let fundingFailureYear: number | null = null;

    if (pullFailures.length > 0) {
      // Get the earliest year with a pull failure
      for (const failure of pullFailures) {
        const failureYear = failure.date.getUTCFullYear();
        if (fundingFailureYear === null || failureYear < fundingFailureYear) {
          fundingFailureYear = failureYear;
        }
      }
    }

    // Extract inflation samples and compute cumulative inflation
    const inflationHandler = await MonteCarloHandler.getInstance(startDate, endDate, seed);
    const inflationByYear = inflationHandler.getInflationByYear();

    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();
    const cumulativeInflation: Record<number, number> = {};

    let cumulative = 1.0;
    for (let year = startYear; year <= endYear; year++) {
      cumulativeInflation[year] = cumulative;
      const rate = inflationByYear[year] || 0;
      cumulative *= (1 + rate);
    }

    // Create aggregated result with yearly data and cumulative inflation
    const aggregatedResult: AggregatedSimulationResult = {
      simulationNumber,
      yearlyMinBalances: balanceData.combined,
      yearlyAccountBalances: balanceData.perAccount,
      cumulativeInflation,
      fundingFailureYear,
    };

    // Write to temporary file - store aggregated data only
    const tempFileName = `${data.simulationId}_sim_${simulationNumber}.json`;
    const tempFilePath = join(data.tempDir, tempFileName);

    writeFileSync(tempFilePath, JSON.stringify(aggregatedResult));
    tempFiles.push(tempFilePath);
  } catch (error) {
    console.error(`❌ [Worker] Simulation ${simulationNumber} failed:`, error);
    throw error;
  }
}

/**
 * Combine all temporary simulation files into the final result using streaming
 * to avoid V8 string length limits with large result sets
 */
async function combineTempFiles(
  tempFiles: string[],
  startDate: Date,
  endDate: Date,
  accountNames: Array<{ id: string; name: string }>,
): Promise<void> {
  try {
    // First pass: collect temp files and their data for sorting
    const tempDataWithFiles: Array<{ file: string; data: AggregatedSimulationResult }> = [];

    for (const tempFile of tempFiles) {
      if (existsSync(tempFile)) {
        const content = readFileSync(tempFile, 'utf-8');
        const result: AggregatedSimulationResult = JSON.parse(content);
        tempDataWithFiles.push({ file: tempFile, data: result });
      }
    }

    // Sort by simulation number
    tempDataWithFiles.sort((a, b) => a.data.simulationNumber - b.data.simulationNumber);

    // Write combined result using streaming to avoid string length limits
    const finalFilePath = join(data.resultsDir, `${data.simulationId}.json`);
    const ws = createWriteStream(finalFilePath, { encoding: 'utf-8' });

    // Write opening object and metadata
    ws.write('{\n');
    ws.write('  "metadata": ');

    const metadata = {
      id: data.simulationId,
      startDate,
      endDate,
      totalSimulations: data.totalSimulations,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      duration: 0,
      accountNames,
      seed: data.seed,
    };
    ws.write(JSON.stringify(metadata, null, 2));

    ws.write(',\n  "results": [\n');

    // Stream each simulation result
    for (let i = 0; i < tempDataWithFiles.length; i++) {
      const simResult = tempDataWithFiles[i].data;

      // Add comma separator (not for first item)
      if (i > 0) {
        ws.write(',\n');
      }

      // Write the result object with proper indentation
      ws.write('    ' + JSON.stringify(simResult));
    }

    ws.write('\n  ]\n}\n');

    // End the write stream to emit 'finish' event
    ws.end();

    // Wait for stream to finish
    await new Promise<void>((resolve, reject) => {
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    // Clean up temp files
    for (const { file: tempFile } of tempDataWithFiles) {
      try {
        if (existsSync(tempFile)) {
          unlinkSync(tempFile);
        }
      } catch (error) {
        console.warn(`⚠️ [Worker] Failed to delete temp file ${tempFile}:`, error);
      }
    }

    console.log(
      `💾 [Worker] Combined ${tempDataWithFiles.length} simulation results into ${finalFilePath}`,
    );
  } catch (error) {
    console.error('❌ [Worker] Error combining temp files:', error);
    throw error;
  }
}

/**
 * Generate and save graph for the simulation
 */
async function generateAndSaveGraph(): Promise<void> {
  try {
    console.log(`📈 [Worker] Generating graph for simulation ${data.simulationId}...`);

    const graphData = await generateMonteCarloStatisticsGraph(data.simulationId, {
      percentiles: [0, 5, 25, 50, 75, 95, 100],
      includeDeterministic: true,
      combineAccounts: true,
    });

    const graphFilePath = join(data.graphsDir, `${data.simulationId}.json`);
    writeFileSync(graphFilePath, JSON.stringify(graphData, null, 2));

    console.log(
      `✅ [Worker] Graph saved for simulation ${data.simulationId} at ${graphFilePath}`,
    );
  } catch (error) {
    console.error(
      `❌ [Worker] Failed to generate graph for simulation ${data.simulationId}:`,
      error,
    );
    // Don't throw - graph generation failure shouldn't fail the entire simulation
  }
}

// Start the worker
runWorkerSimulations().catch((error) => {
  console.error('❌ [Worker] Unhandled error:', error);
  process.exit(1);
});
