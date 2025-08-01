import { loadData } from '../../io/accountsAndTransfers';
import { writeFileSync } from 'fs';

async function main() {
  const result = await loadData(new Date('2025-07-01'), new Date('2025-12-31'), 'Default');

  // Write the result to a file
  const filePath = 'testing/consolidatedData.json';
  writeFileSync(
    filePath,
    JSON.stringify(
      result.accounts.map((a) => {
        const consolidatedActivity = a.consolidatedActivity.map((a) => a.serialize());
        return {
          account: a.name,
          consolidatedActivity,
        };
      }),
      null,
      2,
    ),
    'utf-8',
  );
}

main();
