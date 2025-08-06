import { loadData } from '../../io/accountsAndTransfers';
import { writeFileSync } from 'fs';

const shouldSave = process.argv.includes('--save');

async function main(runId: string) {
  const results = await loadData(
    new Date('2025-07-01'),
    new Date('2025-12-31'),
    'Default',
    {},
    { monteCarlo: true, simulationNumber: 1, totalSimulations: 1 }
  );
  
  if (shouldSave) {
    const file = `testing/consolidatedActivities/results${runId}.json`;
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
    console.log(`Results saved to ${file}`);
  } else {
    console.log(`Run ${runId} completed (results not saved - use --save to save)`);
  }
}

const N_RUNS = 1;

for (let i = 1; i <= N_RUNS; i++) {
  main(i.toString());
}