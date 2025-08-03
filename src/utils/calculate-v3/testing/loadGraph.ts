import { loadData } from '../../io/accountsAndTransfers';
import { loadGraph } from '../../graph/graph';
import { writeFileSync } from 'fs';

async function loadJakeGraphData() {
  const startDate = new Date('2025-07-01');
  const endDate = new Date('2025-07-31');
  
  const data = await loadData(startDate, endDate, 'Default');
  
  const jakeAccount = data.accounts.find(account => account.name === 'Jake');
  
  if (!jakeAccount) {
    throw new Error('Account with name "Jake" not found');
  }
  
  const graphData = loadGraph(
    { accounts: [jakeAccount], transfers: { activity: [], bills: [] } },
    startDate,
    endDate
  );
  
  writeFileSync(
    'testing/loadGraph/jake-graph-july-2025.json',
    JSON.stringify(graphData, null, 2)
  );
  
  console.log('Graph data loaded for Jake from 2025-07-01 to 2025-07-31');
  return graphData;
}

loadJakeGraphData().catch(console.error);