/**
 * Accuracy comparison tests for calculate-v2 system
 *
 * Compares the results from the new calculate-v2 system against the original API
 * to verify accuracy and identify any calculation discrepancies.
 */

import fs from 'fs/promises';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { load } from '../../io/io';
import { AccountsAndTransfersData, AccountsAndTransfers } from '../../../data/account/types';
import { Account } from '../../../data/account/account';
import { Activity } from '../../../data/activity/activity';
import { ActivityData } from '../../../data/activity/types';
import { Bill } from '../../../data/bill/bill';
import { BillData } from '../../../data/bill/types';
import { InterestData } from '../../../data/interest/types';
import { calculateAllActivity } from './../engine';
import { initializeCache } from './../cache';
import { TEST_SCENARIOS } from './fetch-original-responses';
import { formatDate } from '../../date/date';

// Get current directory - works with tsx
// Since we're running from the calculate-v2 directory, we need to go into accuracy-comparison
const currentDir = path.resolve(process.cwd(), 'accuracy-comparison');

interface OriginalResponse {
  accountId: string;
  accountName: string;
  scenario: string;
  startDate: string;
  endDate: string;
  consolidatedActivity: any[];
  error?: string;
}

interface ComparisonResult {
  accountId: string;
  accountName: string;
  scenario: string;
  startDate: string;
  endDate: string;
  original: {
    activityCount: number;
    finalBalance: number;
    lastActivity?: any;
  };
  calculated: {
    activityCount: number;
    finalBalance: number;
    lastActivity?: any;
  };
  differences: {
    activityCountDiff: number;
    balanceDiff: number;
    percentageDiff: number;
    significant: boolean;
  };
  errors: string[];
  success: boolean;
}

interface ComparisonSummary {
  totalComparisons: number;
  successfulComparisons: number;
  failedComparisons: number;
  significantDiscrepancies: number;
  scenarios: Array<{
    scenario: string;
    comparisons: number;
    successful: number;
    failed: number;
    discrepancies: number;
    avgBalanceDiff: number;
    avgActivityCountDiff: number;
  }>;
  accounts: Array<{
    accountName: string;
    comparisons: number;
    successful: number;
    failed: number;
    discrepancies: number;
  }>;
}

/**
 * Loads original responses from saved files
 */
async function loadOriginalResponses(): Promise<OriginalResponse[]> {
  const responsesDir = path.resolve(currentDir, 'original-responses');
  const allResponsesFile = path.join(responsesDir, 'all-responses.json');

  try {
    const data = await fs.readFile(allResponsesFile, 'utf8');
    return JSON.parse(data) as OriginalResponse[];
  } catch (error: any) {
    throw new Error(`Failed to load original responses: ${error.message}`);
  }
}

/**
 * Runs calculate-v2 for a specific scenario
 */
async function runCalculateV2(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: string,
  endDate: string,
): Promise<AccountsAndTransfers> {
  // Initialize cache for each test
  initializeCache(
    {
      diskCacheDir: './temp/calculate-v3-cache-comparison',
      useDiskCache: false,
      snapshotInterval: 'monthly',
    },
    'Default',
  );

  // Clone data for independent testing
  const testData: AccountsAndTransfers = {
    accounts: accountsAndTransfers.accounts.map(
      (account) =>
        new Account({
          ...account.serialize(),
          activity: [...(account.activity || [])].map((activity) => activity.serialize() as ActivityData),
          bills: [...(account.bills || [])].map((bill) => bill.serialize() as BillData),
          interests: [...(account.interests || [])].map((interest) => interest.serialize() as InterestData),
          consolidatedActivity: [], // Clear calculated data
        }),
    ),
    transfers: {
      activity: [...accountsAndTransfers.transfers.activity],
      bills: [...accountsAndTransfers.transfers.bills],
    },
  };

  const newAccountsAndTransfers = await calculateAllActivity(
    testData,
    new Date(startDate),
    new Date(endDate),
    'Default',
    false,
    0,
    0,
    true,
  );

  // Return the updated accounts from the calculation result
  return newAccountsAndTransfers;
}

/**
 * Compares original and calculated results for a single account/scenario
 */
function compareResults(original: OriginalResponse, calculatedAccount: Account): ComparisonResult {
  const errors: string[] = [];

  if (original.error) {
    errors.push(`Original API error: ${original.error}`);
  }

  const originalActivityCount = original.consolidatedActivity?.length || 0;
  const calculatedActivityCount = calculatedAccount.consolidatedActivity?.length || 0;

  const originalLastActivity = original.consolidatedActivity?.[originalActivityCount - 1];
  const calculatedLastActivity = calculatedAccount.consolidatedActivity?.[calculatedActivityCount - 1];

  // When comparing balances, we should only compare if both have activities
  // If no activities exist, we can't determine the balance from the original API response
  const originalFinalBalance = originalLastActivity?.balance || 0;
  const calculatedFinalBalance = calculatedLastActivity?.balance || 0;

  // If there are no activities in either system, balance comparison is not meaningful
  const shouldCompareBalance = originalActivityCount > 0 || calculatedActivityCount > 0;

  const activityCountDiff = calculatedActivityCount - originalActivityCount;
  const balanceDiff = calculatedFinalBalance - originalFinalBalance;
  const percentageDiff =
    originalFinalBalance !== 0 ? Math.abs(balanceDiff / originalFinalBalance) * 100 : balanceDiff !== 0 ? 100 : 0;

  // Consider significant if:
  // - Activity count differs by more than 0
  // - Balance differs by more than $0.01 (but only if we have activities to compare)
  const significant = Math.abs(activityCountDiff) > 0 || (shouldCompareBalance && Math.abs(balanceDiff) > 0.01);

  return {
    accountId: original.accountId,
    accountName: original.accountName,
    scenario: original.scenario,
    startDate: original.startDate,
    endDate: original.endDate,
    original: {
      activityCount: originalActivityCount,
      finalBalance: originalFinalBalance,
      lastActivity: originalLastActivity,
    },
    calculated: {
      activityCount: calculatedActivityCount,
      finalBalance: calculatedFinalBalance,
      lastActivity: calculatedLastActivity,
    },
    differences: {
      activityCountDiff,
      balanceDiff,
      percentageDiff,
      significant,
    },
    errors,
    success: errors.length === 0,
  };
}

/**
 * Runs comprehensive accuracy comparison tests
 */
export async function runAccuracyComparison(): Promise<void> {
  console.log('🔬 Calculate-v2 Accuracy Comparison Testing');
  console.log('==========================================\n');

  try {
    // Load original responses
    console.log('📁 Loading original API responses...');
    const originalResponses = await loadOriginalResponses();
    console.log(`✅ Loaded ${originalResponses.length} original responses`);

    // Load account data
    const data = load<AccountsAndTransfersData>('data.json');
    const accountsAndTransfers: AccountsAndTransfers = {
      accounts: data.accounts.map((accountData) => new Account(accountData)),
      transfers: {
        activity: data.transfers.activity.map((activityData) => new Activity(activityData)),
        bills: data.transfers.bills.map((billData) => new Bill(billData)),
      },
    };

    console.log(
      `📊 Testing ${TEST_SCENARIOS.length} scenarios with ${accountsAndTransfers.accounts.length} accounts\n`,
    );

    const comparisonResults: ComparisonResult[] = [];

    // Run comparisons for each scenario
    for (let scenarioIndex = 0; scenarioIndex < TEST_SCENARIOS.length; scenarioIndex++) {
      const scenario = TEST_SCENARIOS[scenarioIndex];
      console.log(`${scenarioIndex + 1}/${TEST_SCENARIOS.length}: ${scenario.id.toUpperCase()}`);
      console.log(`Date range: ${scenario.startDate} to ${scenario.endDate}`);

      try {
        // Run calculate-v2 for this scenario
        console.log('  🔧 Running calculate-v2...');
        const startTime = performance.now();

        process.env.SCENARIO = scenario.id;
        const calculatedResults = await runCalculateV2(accountsAndTransfers, scenario.startDate, scenario.endDate);

        const endTime = performance.now();
        console.log(`  ⏱️  Calculate-v2 completed in ${(endTime - startTime).toFixed(2)}ms`);

        // Write calculated results to file for analysis
        try {
          mkdirSync(path.resolve(currentDir, 'calculated-activities'), {
            recursive: true,
          });
          const calculatedActivitiesFile = path.join(
            path.resolve(currentDir, 'calculated-activities'),
            `${scenario.id}.json`,
          );

          if (calculatedResults.accounts.length > 0 && calculatedResults.accounts[0].consolidatedActivity?.length > 0) {
            console.log('First result:', calculatedResults.accounts[0].consolidatedActivity[0]);
          }

          // Create account map for easier lookup
          const calculatedDataMap: Record<string, any> = {};
          calculatedResults.accounts.forEach((account) => {
            console.log(
              `  💾 Saving calculated data for account ${account.id} (${account.name}) - ${account.consolidatedActivity?.length || 0} activities`,
            );
            calculatedDataMap[account.id] = {
              id: account.id,
              name: account.name,
              consolidatedActivity: account.consolidatedActivity,
            };
          });

          writeFileSync(calculatedActivitiesFile, JSON.stringify(calculatedDataMap, null, 2));
          console.log(`  💾 Saved calculated activities to ${calculatedActivitiesFile}`);
        } catch (error) {
          console.log(`  ⚠️  Failed to write calculated activities: ${error}`);
        }

        // Compare with original responses for this scenario
        const scenarioOriginals = originalResponses.filter((r) => r.scenario === scenario.id);
        console.log(`  📋 Comparing ${scenarioOriginals.length} accounts...`);

        let scenarioSuccesses = 0;
        let scenarioDiscrepancies = 0;

        for (const originalResponse of scenarioOriginals) {
          const calculatedAccount = calculatedResults.accounts.find((acc) => acc.id === originalResponse.accountId);

          if (!calculatedAccount) {
            console.log(`    ❌ ${originalResponse.accountName}: Account not found in calculated results`);
            continue;
          }

          const comparison = compareResults(originalResponse, calculatedAccount);
          comparisonResults.push(comparison);

          if (comparison.success && !comparison.differences.significant) {
            scenarioSuccesses++;
            console.log(
              `    ✅ ${comparison.accountName}: Match (${comparison.calculated.activityCount} activities, $${comparison.calculated.finalBalance.toFixed(2)})`,
            );
          } else if (comparison.differences.significant) {
            scenarioDiscrepancies++;
            console.log(`    ⚠️ ${comparison.accountName}: Discrepancy`);
            console.log(
              `       Activity count: ${comparison.original.activityCount} → ${comparison.calculated.activityCount} (${comparison.differences.activityCountDiff >= 0 ? '+' : ''}${comparison.differences.activityCountDiff})`,
            );
            console.log(
              `       Final balance: $${comparison.original.finalBalance.toFixed(2)} → $${comparison.calculated.finalBalance.toFixed(2)} (${comparison.differences.balanceDiff >= 0 ? '+' : ''}$${comparison.differences.balanceDiff.toFixed(2)})`,
            );
            if (comparison.differences.percentageDiff > 0) {
              console.log(`       Percentage diff: ${comparison.differences.percentageDiff.toFixed(2)}%`);
            }
          } else {
            console.log(`    ❌ ${comparison.accountName}: Error - ${comparison.errors.join(', ')}`);
          }
        }

        console.log(`  📊 Scenario summary: ${scenarioSuccesses} matches, ${scenarioDiscrepancies} discrepancies\n`);
      } catch (error: any) {
        console.log(`  ❌ Scenario failed: ${error.message}\n`);

        // Add error results for all accounts in this scenario
        const scenarioOriginals = originalResponses.filter((r) => r.scenario === scenario.id);
        for (const originalResponse of scenarioOriginals) {
          comparisonResults.push({
            accountId: originalResponse.accountId,
            accountName: originalResponse.accountName,
            scenario: originalResponse.scenario,
            startDate: originalResponse.startDate,
            endDate: originalResponse.endDate,
            original: {
              activityCount: originalResponse.consolidatedActivity?.length || 0,
              finalBalance: 0,
            },
            calculated: {
              activityCount: 0,
              finalBalance: 0,
            },
            differences: {
              activityCountDiff: 0,
              balanceDiff: 0,
              percentageDiff: 0,
              significant: true,
            },
            errors: [error.message],
            success: false,
          });
        }
      }
    }

    // Generate comprehensive summary
    console.log('📊 ACCURACY COMPARISON RESULTS');
    console.log('==============================\n');

    const summary = generateComparisonSummary(comparisonResults);

    console.log('Overall Statistics:');
    console.log(`  Total comparisons: ${summary.totalComparisons}`);
    console.log(
      `  Successful: ${summary.successfulComparisons} (${((summary.successfulComparisons / summary.totalComparisons) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Failed: ${summary.failedComparisons} (${((summary.failedComparisons / summary.totalComparisons) * 100).toFixed(1)}%)`,
    );
    console.log(
      `  Significant discrepancies: ${summary.significantDiscrepancies} (${((summary.significantDiscrepancies / summary.totalComparisons) * 100).toFixed(1)}%)`,
    );

    // Scenario breakdown
    console.log('\n📋 Scenario Breakdown:');
    for (const scenarioSummary of summary.scenarios) {
      console.log(`  ${scenarioSummary.scenario}:`);
      console.log(`    Comparisons: ${scenarioSummary.comparisons}`);
      console.log(
        `    Successful: ${scenarioSummary.successful} (${((scenarioSummary.successful / scenarioSummary.comparisons) * 100).toFixed(1)}%)`,
      );
      console.log(
        `    Discrepancies: ${scenarioSummary.discrepancies} (${((scenarioSummary.discrepancies / scenarioSummary.comparisons) * 100).toFixed(1)}%)`,
      );
      if (scenarioSummary.avgBalanceDiff !== 0) {
        console.log(`    Avg balance diff: $${scenarioSummary.avgBalanceDiff.toFixed(2)}`);
      }
      if (scenarioSummary.avgActivityCountDiff !== 0) {
        console.log(`    Avg activity count diff: ${scenarioSummary.avgActivityCountDiff.toFixed(1)}`);
      }
    }

    // Save detailed results
    const outputDir = path.resolve(currentDir, 'comparison-results');
    await fs.mkdir(outputDir, { recursive: true });

    const resultsFile = path.join(outputDir, 'accuracy-comparison.json');
    await fs.writeFile(resultsFile, JSON.stringify(comparisonResults, null, 2), 'utf8');

    const summaryFile = path.join(outputDir, 'comparison-summary.json');
    await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');

    // Final verdict
    console.log('\n🎯 FINAL VERDICT:');
    if (summary.significantDiscrepancies === 0) {
      console.log('✅ PERFECT ACCURACY - Calculate-v2 matches original API exactly');
      console.log('🚀 Ready for production deployment');
    } else if (summary.significantDiscrepancies < summary.totalComparisons * 0.1) {
      console.log(
        `⚠️  MINOR DISCREPANCIES - ${summary.significantDiscrepancies} out of ${summary.totalComparisons} comparisons show differences`,
      );
      console.log('🔧 Review discrepancies for production readiness');
    } else {
      console.log(
        `❌ SIGNIFICANT DISCREPANCIES - ${summary.significantDiscrepancies} out of ${summary.totalComparisons} comparisons show differences`,
      );
      console.log('🛠️  Calculate-v2 needs debugging before production use');
    }

    console.log(`\n💾 Detailed results saved to: ${outputDir}`);
    console.log(`📁 Files created:`);
    console.log(`  - accuracy-comparison.json (${comparisonResults.length} detailed comparisons)`);
    console.log(`  - comparison-summary.json (summary statistics)`);

    console.log('\n🎉 Accuracy comparison completed!');
  } catch (error) {
    console.error('\n❌ Accuracy comparison failed:', error);
    throw error;
  }
}

/**
 * Generates comparison summary statistics
 */
function generateComparisonSummary(results: ComparisonResult[]): ComparisonSummary {
  const totalComparisons = results.length;
  const successfulComparisons = results.filter((r) => r.success && !r.differences.significant).length;
  const failedComparisons = results.filter((r) => !r.success).length;
  const significantDiscrepancies = results.filter((r) => r.differences.significant).length;

  // Scenario statistics
  const scenarios = TEST_SCENARIOS.map((scenario) => {
    const scenarioResults = results.filter((r) => r.scenario === scenario.id);
    const successful = scenarioResults.filter((r) => r.success && !r.differences.significant).length;
    const failed = scenarioResults.filter((r) => !r.success).length;
    const discrepancies = scenarioResults.filter((r) => r.differences.significant).length;

    const avgBalanceDiff =
      scenarioResults.length > 0
        ? scenarioResults.reduce((sum, r) => sum + Math.abs(r.differences.balanceDiff), 0) / scenarioResults.length
        : 0;
    const avgActivityCountDiff =
      scenarioResults.length > 0
        ? scenarioResults.reduce((sum, r) => sum + Math.abs(r.differences.activityCountDiff), 0) /
          scenarioResults.length
        : 0;

    return {
      scenario: scenario.id,
      comparisons: scenarioResults.length,
      successful,
      failed,
      discrepancies,
      avgBalanceDiff,
      avgActivityCountDiff,
    };
  });

  // Account statistics
  const accountNames = [...new Set(results.map((r) => r.accountName))];
  const accounts = accountNames.map((accountName) => {
    const accountResults = results.filter((r) => r.accountName === accountName);
    const successful = accountResults.filter((r) => r.success && !r.differences.significant).length;
    const failed = accountResults.filter((r) => !r.success).length;
    const discrepancies = accountResults.filter((r) => r.differences.significant).length;

    return {
      accountName,
      comparisons: accountResults.length,
      successful,
      failed,
      discrepancies,
    };
  });

  return {
    totalComparisons,
    successfulComparisons,
    failedComparisons,
    significantDiscrepancies,
    scenarios,
    accounts,
  };
}

// Run if called directly
// This works with tsx which sets process.argv[1] to the script path
if (process.argv[1] && process.argv[1].includes('accuracy-comparison.ts')) {
  console.log('🧪 Starting Calculate-v2 Accuracy Comparison...\n');

  runAccuracyComparison()
    .then(() => {
      console.log('\n✅ Accuracy comparison completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Accuracy comparison failed:', error);
      process.exit(1);
    });
}
