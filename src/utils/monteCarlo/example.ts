import {
  startMonteCarloSimulation,
  getSimulationProgress,
  isSimulationComplete,
  getSimulationResultPath,
} from './index';
import { loadData } from '../io/accountsAndTransfers';

async function runExample() {
  try {
    // Define date range for the simulation
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2025-01-31');
    
    // Load accounts and transfers data using loadData for a basic setup
    // This gives us a properly initialized AccountsAndTransfers object
    const accountsAndTransfers = await loadData(startDate, endDate, 'Default');

    // Start a Monte Carlo simulation with 20 simulations, batched in groups of 5
    console.log('Starting Monte Carlo simulation...');
    const simulationId = startMonteCarloSimulation(accountsAndTransfers, 20, 5, startDate, endDate);
    console.log(`Simulation started with ID: ${simulationId}`);

    // Monitor progress
    const checkProgress = () => {
      const progress = getSimulationProgress(simulationId);
      if (progress) {
        console.log(
          `Progress: ${progress.progress.toFixed(1)}% (${progress.completedSimulations}/${progress.totalSimulations}) - Status: ${progress.status}`,
        );

        if (progress.status === 'completed') {
          const resultPath = getSimulationResultPath(simulationId);
          console.log(`✅ Simulation completed! Results saved to: ${resultPath}`);
          return;
        } else if (progress.status === 'failed') {
          console.error(`❌ Simulation failed: ${progress.error}`);
          return;
        }
      }

      // Check again in 2 seconds
      setTimeout(checkProgress, 2000);
    };

    // Start monitoring
    checkProgress();
  } catch (error) {
    console.error('Error running example:', error);
  }
}

/**
 * Example showing how to check if a specific simulation is complete
 */
async function checkSimulationExample(simulationId: string) {
  console.log(`Checking simulation ${simulationId}...`);

  // Simple boolean check
  if (isSimulationComplete(simulationId)) {
    console.log('✅ Simulation is complete!');

    // Get the results file path
    const resultPath = getSimulationResultPath(simulationId);
    if (resultPath) {
      console.log(`Results available at: ${resultPath}`);
    }
  } else {
    console.log('⏳ Simulation is not yet complete');

    // Get detailed progress information
    const progress = getSimulationProgress(simulationId);
    if (progress) {
      console.log(`Status: ${progress.status}`);
      console.log(
        `Progress: ${progress.progress.toFixed(1)}% (${progress.completedSimulations}/${progress.totalSimulations})`,
      );

      if (progress.status === 'failed' && progress.error) {
        console.error(`Error: ${progress.error}`);
      }
    } else {
      console.log('❌ Simulation ID not found');
    }
  }
}

/**
 * Example showing how to wait for a simulation to complete
 */
async function waitForCompletion(simulationId: string): Promise<string | null> {
  return new Promise((resolve) => {
    const checkComplete = () => {
      if (isSimulationComplete(simulationId)) {
        const resultPath = getSimulationResultPath(simulationId);
        resolve(resultPath);
        return;
      }

      const progress = getSimulationProgress(simulationId);
      if (progress?.status === 'failed') {
        console.error(`Simulation failed: ${progress.error}`);
        resolve(null);
        return;
      }

      // Check again in 1 second
      setTimeout(checkComplete, 1000);
    };

    checkComplete();
  });
}

// Uncomment the lines below to run the examples
runExample();

export { runExample, checkSimulationExample, waitForCompletion };
