import { loadData } from '../../io/accountsAndTransfers';
import { writeFileSync } from 'fs';

async function main(runId: string) {
  const results = await loadData(new Date('2024-01-01'), new Date('2083-12-31'), 'Default');
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
}

const N_RUNS = 1;

for (let i = 1; i <= N_RUNS; i++) {
  main(i.toString());
}
