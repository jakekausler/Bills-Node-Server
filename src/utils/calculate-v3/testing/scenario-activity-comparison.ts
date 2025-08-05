#!/usr/bin/env tsx

import * as fs from 'fs';
import * as path from 'path';

interface Activity {
  id: string;
  name: string;
  category: string;
  flag: boolean;
  flagColor: string | null;
  isTransfer: boolean;
  from?: string | null;
  fro?: string | null; // Calculated activities use 'fro' instead of 'from'
  to: string | null;
  amount: number;
  amountIsVariable: boolean;
  amountVariable: string | null;
  date: string;
  dateIsVariable: boolean;
  dateVariable: string | null;
  balance?: number;
  billId: string | null;
  firstBill: boolean;
  interestId: string | null;
  firstInterest: boolean;
}

interface CalculatedAccount {
  id: string;
  name: string;
  consolidatedActivity: Activity[];
}

interface OriginalResponse {
  accountId: string;
  accountName: string;
  scenario: string;
  startDate: string;
  endDate: string;
  consolidatedActivity: Activity[];
}

interface ComparisonResult {
  account: string;
  scenario: string;
  totalOriginal: number;
  totalCalculated: number;
  exactMatches: number;
  missingInCalculated: Activity[];
  extraInCalculated: Activity[];
  differences: {
    activity: Activity;
    issue: string;
    originalActivity?: Activity;
  }[];
}

function normalizeActivity(activity: Activity): Activity {
  // Normalize 'from'/'fro' field difference
  const normalized = { ...activity };
  if (normalized.fro !== undefined) {
    normalized.from = normalized.fro;
    delete normalized.fro;
  }
  // Remove balance field for comparison as it's calculated
  delete normalized.balance;
  return normalized;
}

function numbersEqual(a: number, b: number, tolerance: number = 0.001): boolean {
  return Math.abs(a - b) <= tolerance;
}

function activitiesEqual(a1: Activity, a2: Activity): boolean {
  const norm1 = normalizeActivity(a1);
  const norm2 = normalizeActivity(a2);

  // Match based on meaningful properties, not IDs
  return (
    norm1.category === norm2.category &&
    numbersEqual(norm1.amount, norm2.amount) &&
    norm1.date === norm2.date &&
    norm1.isTransfer === norm2.isTransfer
  );
}

function compareActivities(
  originalActivities: Activity[],
  calculatedActivities: Activity[],
): {
  exactMatches: number;
  missingInCalculated: Activity[];
  extraInCalculated: Activity[];
  differences: { activity: Activity; issue: string; originalActivity?: Activity }[];
} {
  const exactMatches: Activity[] = [];
  const missingInCalculated: Activity[] = [];
  const extraInCalculated: Activity[] = [];
  const differences: { activity: Activity; issue: string; originalActivity?: Activity }[] = [];

  const maxLength = Math.max(originalActivities.length, calculatedActivities.length);

  // Compare activities at each position
  for (let i = 0; i < maxLength; i++) {
    const origActivity = originalActivities[i];
    const calcActivity = calculatedActivities[i];

    if (origActivity && calcActivity) {
      if (activitiesEqual(origActivity, calcActivity)) {
        exactMatches.push(origActivity);
      } else {
        differences.push({
          activity: calcActivity,
          issue: `Position ${i}: Data mismatch`,
          originalActivity: origActivity,
        });
      }
    } else if (origActivity && !calcActivity) {
      missingInCalculated.push(origActivity);
    } else if (!origActivity && calcActivity) {
      extraInCalculated.push(calcActivity);
    }
  }

  return {
    exactMatches: exactMatches.length,
    missingInCalculated,
    extraInCalculated,
    differences,
  };
}

function compareScenario(scenarioName: string): ComparisonResult[] {
  const calculatedPath = path.join(__dirname, '../accuracy-comparison/calculated-activities', `${scenarioName}.json`);
  const originalPath = path.join(__dirname, '../accuracy-comparison/original-responses/all-responses.json');

  if (!fs.existsSync(calculatedPath)) {
    console.error(`Calculated activities file not found: ${calculatedPath}`);
    return [];
  }

  if (!fs.existsSync(originalPath)) {
    console.error(`Original responses file not found: ${originalPath}`);
    return [];
  }

  // Load calculated activities
  const calculatedData: Record<string, CalculatedAccount> = JSON.parse(fs.readFileSync(calculatedPath, 'utf8'));

  // Load original responses
  const originalResponses: OriginalResponse[] = JSON.parse(fs.readFileSync(originalPath, 'utf8'));

  originalResponses.forEach((response) => {
    response.consolidatedActivity.forEach((activity) => {
      activity.amount = Math.round(activity.amount * 100) / 100; // Round amounts to 2 decimal places
      activity.balance = activity.balance !== undefined ? Math.round(activity.balance * 100) / 100 : undefined;
    });
  });

  // Filter original responses for this scenario
  const scenarioOriginals = originalResponses.filter((response) => response.scenario === scenarioName);

  const results: ComparisonResult[] = [];

  // Compare each account
  for (const original of scenarioOriginals) {
    const calculated = calculatedData[original.accountId];

    if (!calculated) {
      console.warn(`No calculated data found for account ${original.accountName} (${original.accountId})`);
      continue;
    }

    const comparison = compareActivities(
      [...original.consolidatedActivity], // Clone to avoid mutation
      [...calculated.consolidatedActivity], // Clone to avoid mutation
    );

    results.push({
      account: original.accountName,
      scenario: scenarioName,
      totalOriginal: original.consolidatedActivity.length,
      totalCalculated: calculated.consolidatedActivity.length,
      exactMatches: comparison.exactMatches,
      missingInCalculated: comparison.missingInCalculated,
      extraInCalculated: comparison.extraInCalculated,
      differences: comparison.differences,
    });
  }

  return results;
}

// ANSI color codes
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function formatSideBySide(original: Activity, calculated: Activity, position: number): string {
  const origNorm = normalizeActivity(original);
  const calcNorm = normalizeActivity(calculated);

  const origName = origNorm.name || 'N/A';
  const calcName = calcNorm.name || 'N/A';

  // Calculate column widths for alignment
  const nameColWidth = Math.max(15, Math.max(origName.length, calcName.length) + 2);
  const valueColWidth = 20;

  let output = `\n${colors.bold}Position ${position}:${colors.reset}\n`;

  // Header row with names
  const origNamePadded = origName.padEnd(nameColWidth);
  const calcNamePadded = calcName.padEnd(nameColWidth);
  output += `        ${colors.green}${origNamePadded}${colors.reset}${colors.red}${calcNamePadded}${colors.reset}\n`;

  // Amount row (always show for comparison)
  const origAmount = String(origNorm.amount).padEnd(valueColWidth);
  const calcAmount = String(calcNorm.amount).padEnd(valueColWidth);
  const amountDiff = origNorm.amount !== calcNorm.amount;
  output += `${colors.yellow}Amount  ${colors.reset}${amountDiff ? colors.green : ''}${origAmount}${colors.reset}${amountDiff ? colors.red : ''}${calcAmount}${colors.reset}\n`;

  // Balance row (always show for comparison)
  const origBalance = String(original.balance !== undefined ? original.balance : 'N/A').padEnd(valueColWidth);
  const calcBalance = String(calculated.balance !== undefined ? calculated.balance : 'N/A').padEnd(valueColWidth);
  const balanceDiff = original.balance !== calculated.balance;
  output += `${colors.yellow}Balance ${colors.reset}${balanceDiff ? colors.green : ''}${origBalance}${colors.reset}${balanceDiff ? colors.red : ''}${calcBalance}${colors.reset}\n`;

  // Date row (always show for comparison)
  const origDate = String(origNorm.date).padEnd(valueColWidth);
  const calcDate = String(calcNorm.date).padEnd(valueColWidth);
  const dateDiff = origNorm.date !== calcNorm.date;
  output += `${colors.yellow}Date    ${colors.reset}${dateDiff ? colors.green : ''}${origDate}${colors.reset}${dateDiff ? colors.red : ''}${calcDate}${colors.reset}\n`;

  // Additional differing fields

  if (origNorm.category !== calcNorm.category) {
    const origCat = String(origNorm.category).padEnd(valueColWidth);
    const calcCat = String(calcNorm.category).padEnd(valueColWidth);
    output += `${colors.yellow}Category${colors.reset}${colors.green}${origCat}${colors.reset}${colors.red}${calcCat}${colors.reset}\n`;
  }

  return output;
}

function printResults(results: ComparisonResult[], detailed: boolean = false, account: string | null = null): void {
  console.log(`\n=== Scenario Activity Comparison Results ===\n`);

  let totalOriginal = 0;
  let totalCalculated = 0;
  let totalMatches = 0;
  let totalMissing = 0;
  let totalExtra = 0;
  let totalDifferences = 0;

  for (const result of results) {
    if (account && result.account !== account) {
      continue; // Skip if account filter is applied
    }
    totalOriginal += result.totalOriginal;
    totalCalculated += result.totalCalculated;
    totalMatches += result.exactMatches;
    totalMissing += result.missingInCalculated.length;
    totalExtra += result.extraInCalculated.length;
    totalDifferences += result.differences.length;

    const accuracy = result.totalOriginal > 0 ? ((result.exactMatches / result.totalOriginal) * 100).toFixed(1) : '0.0';

    console.log(`${colors.bold}${result.account} (${result.scenario}):${colors.reset}`);
    console.log(`  Original: ${result.totalOriginal} activities`);
    console.log(`  Calculated: ${result.totalCalculated} activities`);
    console.log(`  ${colors.green}Exact matches: ${result.exactMatches} (${accuracy}%)${colors.reset}`);
    console.log(`  Missing in calculated: ${result.missingInCalculated.length}`);
    console.log(`  Extra in calculated: ${result.extraInCalculated.length}`);
    console.log(`  ${colors.yellow}Data differences: ${result.differences.length}${colors.reset}`);

    if (detailed && result.differences.length > 0) {
      console.log(`\n${colors.bold}  Detailed Differences:${colors.reset}`);
      result.differences.forEach((diff) => {
        if (diff.originalActivity) {
          const positionMatch = diff.issue.match(/Position (\d+)/);
          const position = positionMatch ? parseInt(positionMatch[1]) : 0;
          console.log(formatSideBySide(diff.originalActivity, diff.activity, position));
        }
      });
    }

    if (detailed) {
      if (result.missingInCalculated.length > 0) {
        console.log(`\n${colors.red}  Missing activities:${colors.reset}`);
        result.missingInCalculated.forEach((activity) => {
          console.log(`    - ${activity.name} (${activity.date}): ${activity.amount}`);
        });
      }

      if (result.extraInCalculated.length > 0) {
        console.log(`\n${colors.blue}  Extra activities:${colors.reset}`);
        result.extraInCalculated.forEach((activity) => {
          console.log(`    - ${activity.name} (${activity.date}): ${activity.amount}`);
        });
      }
    }

    console.log('');
  }

  // Summary
  if (account) {
    return; // No overall summary if account filter is applied
  }
  const overallAccuracy = totalOriginal > 0 ? ((totalMatches / totalOriginal) * 100).toFixed(1) : '0.0';

  console.log(`${colors.bold}=== Overall Summary ===${colors.reset}`);
  console.log(`Total original activities: ${totalOriginal}`);
  console.log(`Total calculated activities: ${totalCalculated}`);
  console.log(`${colors.green}Total exact matches: ${totalMatches} (${overallAccuracy}%)${colors.reset}`);
  console.log(`Total missing: ${totalMissing}`);
  console.log(`Total extra: ${totalExtra}`);
  console.log(`${colors.yellow}Total data differences: ${totalDifferences}${colors.reset}`);
}

// Main execution
function main() {
  const args = process.argv.slice(2);
  const scenarioName = args[0];
  const detailed = args.includes('--detailed') || args.includes('-d');
  const account = args.includes('--account') || args.includes('-a') ? args[args.indexOf('--account') + 1] : null;

  if (!scenarioName) {
    console.error('Usage: npx tsx scenario-activity-comparison.ts <scenario> [--detailed]');
    console.error(
      'Available scenarios: historical_to_current, current_to_near_future, recent_to_medium_term, extended_projection, far_future_projection',
    );
    process.exit(1);
  }

  const results = compareScenario(scenarioName);

  if (results.length === 0) {
    console.error(`No comparison results for scenario: ${scenarioName}`);
    process.exit(1);
  }

  printResults(results, detailed, account);
}

if (require.main === module) {
  main();
}

export { compareScenario, ComparisonResult };
