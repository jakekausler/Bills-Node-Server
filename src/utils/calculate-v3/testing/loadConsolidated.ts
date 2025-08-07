import { loadData } from '../../io/accountsAndTransfers';
import { writeFileSync } from 'fs';

const shouldSave = process.argv.includes('--save');

async function runSimulation(simulationNumber: number, totalSimulations: number) {
  console.log(`[${new Date().toISOString()}] Starting simulation ${simulationNumber}/${totalSimulations}...`);
  const startTime = Date.now();

  try {
    const results = await loadData(
      new Date('2025-01-01'),
      new Date('2027-12-31'),
      'Default',
      {},
      { monteCarlo: true, simulationNumber, totalSimulations, enableLogging: false },
    );

    const elapsedTime = Date.now() - startTime;

    if (shouldSave) {
      const file = `testing/consolidatedActivities/results_sim${simulationNumber}.json`;
      writeFileSync(
        file,
        JSON.stringify(
          results.accounts.map((a) => {
            return {
              account: a.name,
              consolidatedActivity: a.consolidatedActivity.map((c) => c.serialize()),
            };
          }),
        ),
      );
      console.log(`✓ Simulation ${simulationNumber} completed in ${elapsedTime}ms - saved to ${file}`);
    } else {
      console.log(`✓ Simulation ${simulationNumber} completed in ${elapsedTime}ms`);
    }

    // Return the final balance for each account to verify variability
    const balances: Record<string, number> = {};
    results.accounts.forEach((a) => {
      const lastActivity = a.consolidatedActivity?.[a.consolidatedActivity.length - 1];
      if (lastActivity) {
        balances[a.name] = lastActivity.balance;
      }
    });

    return { simulationNumber, elapsedTime, balances };
  } catch (error) {
    console.error(`❌ Simulation ${simulationNumber} failed:`, error);
    throw error;
  }
}

const N_RUNS = 1;

async function runSimulationsInParallel() {
  console.log(`=== Running ${N_RUNS} Monte Carlo simulations IN PARALLEL ===\n`);
  const overallStart = Date.now();

  // Create an array of promises for parallel execution
  const simulationPromises = [];
  for (let i = 1; i <= N_RUNS; i++) {
    simulationPromises.push(runSimulation(i, N_RUNS));
  }

  // Run all simulations in parallel
  console.log('Launching all simulations simultaneously...\n');
  const results = await Promise.all(simulationPromises);

  const totalTime = Date.now() - overallStart;

  // Extract balances from results
  const allBalances = results.map((r) => r.balances);

  // Show timing statistics
  console.log('\n=== Timing Statistics ===');
  const times = results.map((r) => r.elapsedTime);
  console.log(`Total parallel execution time: ${totalTime}ms`);
  console.log(`Average simulation time: ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(0)}ms`);
  console.log(`Min simulation time: ${Math.min(...times)}ms`);
  console.log(`Max simulation time: ${Math.max(...times)}ms`);

  // Show balance statistics to verify Monte Carlo variability
  console.log('\n=== Monte Carlo Results Summary ===');
  console.log('Final balances across simulations:\n');

  // Get all account names
  const accountNames = Object.keys(allBalances[0] || {});

  for (const accountName of accountNames) {
    const values = allBalances.map((b) => b[accountName]).filter((v) => v !== undefined);
    if (values.length > 0) {
      const min = Math.min(...values);
      const max = Math.max(...values);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
      const stdDev = Math.sqrt(variance);

      console.log(`${accountName}:`);
      console.log(`  Min:    $${min.toFixed(2)}`);
      console.log(`  Max:    $${max.toFixed(2)}`);
      console.log(`  Avg:    $${avg.toFixed(2)}`);
      console.log(`  StdDev: $${stdDev.toFixed(2)}`);
      console.log(`  Range:  $${(max - min).toFixed(2)}`);

      // Check if there's variability (Monte Carlo is working)
      if (stdDev < 0.01) {
        console.log(`  ⚠️  Warning: No variability detected - Monte Carlo may not be working`);
      } else {
        console.log(`  ✓ Variability detected - Monte Carlo is working`);
      }
      console.log('');
    }
  }

  console.log('✅ All parallel simulations completed successfully!');
  console.log(
    `⏱️  Parallel speedup: ${((N_RUNS * times.reduce((a, b) => a + b, 0)) / times.length / totalTime).toFixed(2)}x`,
  );
}

// Run the simulations
runSimulationsInParallel().catch((error) => {
  console.error('Error running simulations:', error);
  process.exit(1);
});
