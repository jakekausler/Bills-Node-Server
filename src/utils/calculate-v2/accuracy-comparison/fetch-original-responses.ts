/**
 * Fetches original API responses for all test scenarios and accounts
 * to use as ground truth for comparison testing
 */

import fs from 'fs/promises';
import path from 'path';
import { load } from '../../io/io';
import { AccountsAndTransfersData } from '../../../data/account/types';

interface TestScenario {
  id: string;
  description: string;
  startDate: string;
  endDate: string;
}

interface OriginalResponse {
  accountId: string;
  accountName: string;
  scenario: string;
  startDate: string;
  endDate: string;
  consolidatedActivity: any[];
  error?: string;
}

/**
 * Test scenarios from comprehensive tests
 */
const TEST_SCENARIOS: TestScenario[] = [
  {
    id: 'historical_to_current',
    description: 'Historical data processing (earliest to today)',
    startDate: '2024-01-01',
    endDate: '2025-07-19',
  },
  {
    id: 'current_to_near_future',
    description: 'Near-term projection (today to 1 month)',
    startDate: '2025-07-19',
    endDate: '2025-08-19',
  },
  {
    id: 'recent_to_medium_term',
    description: 'Medium-term projection (1 month ago to 1 year)',
    startDate: '2025-06-19',
    endDate: '2026-07-19',
  },
  {
    id: 'extended_projection',
    description: 'Long-term projection (2 months ago to 10 years)',
    startDate: '2025-05-19',
    endDate: '2035-07-19',
  },
  {
    id: 'far_future_projection',
    description: 'Far-future projection (20 to 50 years)',
    startDate: '2045-07-19',
    endDate: '2075-07-19',
  },
];

/**
 * Fetches consolidated activity from original API
 */
async function fetchOriginalConsolidatedActivity(
  accountId: string,
  startDate: string,
  endDate: string,
): Promise<any[]> {
  const url = `http://localhost:5002/api/accounts/${accountId}/consolidated_activity?startDate=${startDate}&endDate=${endDate}`;

  try {
    console.log(`    Fetching: ${url}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error(`    ❌ Failed to fetch: ${error.message}`);
    throw error;
  }
}

/**
 * Gets all account IDs and names from data
 */
function getAccounts(): Array<{ id: string; name: string }> {
  const data = load<AccountsAndTransfersData>('data.json');
  return data.accounts.map((acc) => ({ id: acc.id, name: acc.name }));
}

/**
 * Fetches all original responses for comparison
 */
async function fetchAllOriginalResponses(): Promise<void> {
  console.log('🔍 Fetching Original API Responses for Comparison Testing');
  console.log('=======================================================\n');

  const accounts = getAccounts();
  console.log(`📁 Found ${accounts.length} accounts to test`);

  const responses: OriginalResponse[] = [];
  const outputDir = path.join(process.cwd(), 'original-responses');

  // Ensure output directory exists
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create output directory: ${error}`);
    return;
  }

  // Fetch responses for each scenario and account
  for (let scenarioIndex = 0; scenarioIndex < TEST_SCENARIOS.length; scenarioIndex++) {
    const scenario = TEST_SCENARIOS[scenarioIndex];
    console.log(`\n${scenarioIndex + 1}/${TEST_SCENARIOS.length}: ${scenario.id.toUpperCase()}`);
    console.log(`Description: ${scenario.description}`);
    console.log(`Date range: ${scenario.startDate} to ${scenario.endDate}`);

    const scenarioResponses: OriginalResponse[] = [];

    for (let accountIndex = 0; accountIndex < accounts.length; accountIndex++) {
      const account = accounts[accountIndex];
      console.log(`  ${accountIndex + 1}/${accounts.length}: ${account.name} (${account.id})`);

      try {
        const consolidatedActivity = await fetchOriginalConsolidatedActivity(
          account.id,
          scenario.startDate,
          scenario.endDate,
        );

        const response: OriginalResponse = {
          accountId: account.id,
          accountName: account.name,
          scenario: scenario.id,
          startDate: scenario.startDate,
          endDate: scenario.endDate,
          consolidatedActivity,
        };

        scenarioResponses.push(response);
        console.log(`    ✅ Fetched ${consolidatedActivity.length} activities`);

        // Small delay to avoid overwhelming the API
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        const response: OriginalResponse = {
          accountId: account.id,
          accountName: account.name,
          scenario: scenario.id,
          startDate: scenario.startDate,
          endDate: scenario.endDate,
          consolidatedActivity: [],
          error: error.message,
        };

        scenarioResponses.push(response);
        console.log(`    ❌ Error: ${error.message}`);
      }
    }

    // Save scenario responses
    const scenarioFile = path.join(outputDir, `${scenario.id}.json`);
    await fs.writeFile(scenarioFile, JSON.stringify(scenarioResponses, null, 2), 'utf8');
    console.log(`  💾 Saved ${scenarioResponses.length} responses to ${scenario.id}.json`);

    responses.push(...scenarioResponses);
  }

  // Save all responses in one file for easy access
  const allResponsesFile = path.join(outputDir, 'all-responses.json');
  await fs.writeFile(allResponsesFile, JSON.stringify(responses, null, 2), 'utf8');

  // Create summary
  const summary = {
    totalScenarios: TEST_SCENARIOS.length,
    totalAccounts: accounts.length,
    totalResponses: responses.length,
    successfulResponses: responses.filter((r) => !r.error).length,
    failedResponses: responses.filter((r) => r.error).length,
    scenarios: TEST_SCENARIOS.map((scenario) => ({
      id: scenario.id,
      description: scenario.description,
      accountResponses: responses.filter((r) => r.scenario === scenario.id).length,
      successfulAccounts: responses.filter((r) => r.scenario === scenario.id && !r.error).length,
      failedAccounts: responses.filter((r) => r.scenario === scenario.id && r.error).length,
    })),
    generatedAt: new Date().toISOString(),
  };

  const summaryFile = path.join(outputDir, 'summary.json');
  await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n📊 FETCH SUMMARY`);
  console.log(`===============`);
  console.log(`Total scenarios: ${summary.totalScenarios}`);
  console.log(`Total accounts: ${summary.totalAccounts}`);
  console.log(`Total responses: ${summary.totalResponses}`);
  console.log(
    `Successful: ${summary.successfulResponses} (${((summary.successfulResponses / summary.totalResponses) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Failed: ${summary.failedResponses} (${((summary.failedResponses / summary.totalResponses) * 100).toFixed(1)}%)`,
  );

  if (summary.failedResponses > 0) {
    console.log(`\n⚠️  Some requests failed. Check individual scenario files for error details.`);
  }

  console.log(`\n💾 All responses saved to: ${outputDir}`);
  console.log(`📁 Files created:`);
  console.log(`  - all-responses.json (${summary.totalResponses} responses)`);
  console.log(`  - summary.json (fetch statistics)`);

  for (const scenario of TEST_SCENARIOS) {
    console.log(`  - ${scenario.id}.json (${accounts.length} account responses)`);
  }

  console.log(`\n🎉 Original API response fetching completed!`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🚀 Starting Original API Response Fetching...\n');

  fetchAllOriginalResponses()
    .then(() => {
      console.log('\n✅ Fetch completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Fetch failed:', error);
      process.exit(1);
    });
}

export { fetchAllOriginalResponses, TEST_SCENARIOS };

