import { generateMonteCarloStatisticsGraph } from './statisticsGraph';

// Example usage
async function exampleUsage() {
  try {
    // Generate statistics graph for existing simulation
    const simulationId = '57bae69a-d662-4634-a8bd-c4c1358f2b96';

    // Use default percentiles: [0, 10, 25, 50, 75, 90, 100]
    const graphData = await generateMonteCarloStatisticsGraph(simulationId);

    console.log('Graph type:', graphData.type);
    console.log('Years:', graphData.labels);
    console.log('Percentile datasets:');

    graphData.datasets.forEach((dataset) => {
      console.log(
        `- ${dataset.label}: [${dataset.data.slice(0, 3).join(', ')}${dataset.data.length > 3 ? '...' : ''}]`,
      );
    });

    // Example with custom percentiles
    const customGraphData = await generateMonteCarloStatisticsGraph(simulationId, [10, 50, 90]);
    console.log('\nCustom percentiles (10th, 50th, 90th):');
    customGraphData.datasets.forEach((dataset) => {
      console.log(
        `- ${dataset.label}: [${dataset.data.slice(0, 3).join(', ')}${dataset.data.length > 3 ? '...' : ''}]`,
      );
    });
  } catch (error) {
    console.error('Error generating statistics graph:', error);
  }
}

// Uncomment to run example
exampleUsage();

export { exampleUsage };
