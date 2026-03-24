#!/usr/bin/env node
/**
 * Compares consolidated activities between dev and prod servers.
 * Generates monthly summaries by category and by name, then highlights differences.
 *
 * Usage: node compare-consolidated-activities.js <dev_file> <prod_file> <output_dir>
 */

const fs = require('fs');
const path = require('path');

const devFile = process.argv[2];
const prodFile = process.argv[3];
const outputDir = process.argv[4] || '/tmp/activity-comparison';

if (!devFile || !prodFile) {
  console.error('Usage: node compare-consolidated-activities.js <dev_file> <prod_file> [output_dir]');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

console.log('Loading data files...');
const devData = JSON.parse(fs.readFileSync(devFile, 'utf8'));
const prodData = JSON.parse(fs.readFileSync(prodFile, 'utf8'));

function getNetAmount(activity) {
  // For paycheck activities, use netPay from paycheckDetails if available
  if (activity.isPaycheckActivity && activity.paycheckDetails && activity.paycheckDetails.netPay !== undefined) {
    return activity.paycheckDetails.netPay;
  }
  return typeof activity.amount === 'number' ? activity.amount : parseFloat(activity.amount) || 0;
}

function isTransfer(activity) {
  return activity.isTransfer === true;
}

function getYearMonth(dateStr) {
  if (!dateStr) return null;
  // Handle both "YYYY-MM-DD" and longer date strings
  const match = dateStr.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function getCategoryKey(activity) {
  return activity.category || 'Uncategorized';
}

function getNameKey(activity) {
  return activity.name || 'Unnamed';
}

function buildMonthlyView(data, keyFn) {
  // Returns: { 'YYYY-MM': { accountId: { accountName, items: { key: { sum, count } } } } }
  const result = {};

  for (const [accountId, accountData] of Object.entries(data)) {
    const accountName = accountData.name;
    const activities = accountData.activities || [];

    for (const activity of activities) {
      if (isTransfer(activity)) continue;

      const ym = getYearMonth(activity.date);
      if (!ym) continue;

      const key = keyFn(activity);
      const amount = getNetAmount(activity);

      if (!result[ym]) result[ym] = {};
      if (!result[ym][accountId]) result[ym][accountId] = { accountName, items: {}, total: 0 };
      if (!result[ym][accountId].items[key]) result[ym][accountId].items[key] = { sum: 0, count: 0 };

      result[ym][accountId].items[key].sum += amount;
      result[ym][accountId].items[key].count += 1;
      result[ym][accountId].total += amount;
    }
  }

  return result;
}

function buildMonthlySummary(data) {
  // Returns: { 'YYYY-MM': { accountId: { accountName, total } } }
  const result = {};

  for (const [accountId, accountData] of Object.entries(data)) {
    const accountName = accountData.name;
    const activities = accountData.activities || [];

    for (const activity of activities) {
      if (isTransfer(activity)) continue;

      const ym = getYearMonth(activity.date);
      if (!ym) continue;

      const amount = getNetAmount(activity);

      if (!result[ym]) result[ym] = {};
      if (!result[ym][accountId]) result[ym][accountId] = { accountName, total: 0 };
      result[ym][accountId].total += amount;
    }
  }

  return result;
}

function compareMonthlyTotals(devSummary, prodSummary) {
  const allMonths = new Set([...Object.keys(devSummary), ...Object.keys(prodSummary)]);
  const allAccountIds = new Set();

  for (const ym of allMonths) {
    if (devSummary[ym]) Object.keys(devSummary[ym]).forEach(id => allAccountIds.add(id));
    if (prodSummary[ym]) Object.keys(prodSummary[ym]).forEach(id => allAccountIds.add(id));
  }

  // Build account name lookup
  const accountNames = {};
  for (const ym of allMonths) {
    for (const src of [devSummary[ym], prodSummary[ym]]) {
      if (!src) continue;
      for (const [id, data] of Object.entries(src)) {
        accountNames[id] = data.accountName;
      }
    }
  }

  const diffs = [];
  const sortedMonths = [...allMonths].sort();

  for (const ym of sortedMonths) {
    const devMonth = devSummary[ym] || {};
    const prodMonth = prodSummary[ym] || {};

    for (const accountId of allAccountIds) {
      const devTotal = devMonth[accountId]?.total ?? 0;
      const prodTotal = prodMonth[accountId]?.total ?? 0;
      const diff = devTotal - prodTotal;

      if (Math.abs(diff) > 0.01) {
        diffs.push({
          month: ym,
          accountId,
          accountName: accountNames[accountId] || 'Unknown',
          devTotal: Math.round(devTotal * 100) / 100,
          prodTotal: Math.round(prodTotal * 100) / 100,
          diff: Math.round(diff * 100) / 100,
        });
      }
    }
  }

  return diffs;
}

function compareCategoryDetails(devView, prodView) {
  // For months with differences, show which categories differ
  const allMonths = new Set([...Object.keys(devView), ...Object.keys(prodView)]);
  const details = [];

  for (const ym of [...allMonths].sort()) {
    const devMonth = devView[ym] || {};
    const prodMonth = prodView[ym] || {};
    const allAccountIds = new Set([...Object.keys(devMonth), ...Object.keys(prodMonth)]);

    for (const accountId of allAccountIds) {
      const devAccount = devMonth[accountId] || { accountName: 'Unknown', items: {}, total: 0 };
      const prodAccount = prodMonth[accountId] || { accountName: 'Unknown', items: {}, total: 0 };

      const totalDiff = (devAccount.total || 0) - (prodAccount.total || 0);
      if (Math.abs(totalDiff) < 0.01) continue;

      const allKeys = new Set([...Object.keys(devAccount.items || {}), ...Object.keys(prodAccount.items || {})]);
      const categoryDiffs = [];

      for (const key of [...allKeys].sort()) {
        const devItem = devAccount.items?.[key] || { sum: 0, count: 0 };
        const prodItem = prodAccount.items?.[key] || { sum: 0, count: 0 };
        const itemDiff = devItem.sum - prodItem.sum;

        if (Math.abs(itemDiff) > 0.01) {
          categoryDiffs.push({
            key,
            devSum: Math.round(devItem.sum * 100) / 100,
            devCount: devItem.count,
            prodSum: Math.round(prodItem.sum * 100) / 100,
            prodCount: prodItem.count,
            diff: Math.round(itemDiff * 100) / 100,
          });
        }
      }

      if (categoryDiffs.length > 0) {
        details.push({
          month: ym,
          accountId,
          accountName: devAccount.accountName || prodAccount.accountName,
          totalDiff: Math.round(totalDiff * 100) / 100,
          categories: categoryDiffs,
        });
      }
    }
  }

  return details;
}

// Build views
console.log('Building monthly views by category...');
const devByCategory = buildMonthlyView(devData, getCategoryKey);
const prodByCategory = buildMonthlyView(prodData, getCategoryKey);

console.log('Building monthly views by name...');
const devByName = buildMonthlyView(devData, getNameKey);
const prodByName = buildMonthlyView(prodData, getNameKey);

console.log('Building monthly summaries...');
const devSummary = buildMonthlySummary(devData);
const prodSummary = buildMonthlySummary(prodData);

// Compare
console.log('Comparing monthly totals...');
const monthlyDiffs = compareMonthlyTotals(devSummary, prodSummary);

console.log('Comparing category details...');
const categoryDetails = compareCategoryDetails(devByCategory, prodByCategory);

console.log('Comparing name details...');
const nameDetails = compareCategoryDetails(devByName, prodByName);

// Write outputs
fs.writeFileSync(path.join(outputDir, 'dev-by-category.json'), JSON.stringify(devByCategory, null, 2));
fs.writeFileSync(path.join(outputDir, 'dev-by-name.json'), JSON.stringify(devByName, null, 2));
fs.writeFileSync(path.join(outputDir, 'prod-by-category.json'), JSON.stringify(prodByCategory, null, 2));
fs.writeFileSync(path.join(outputDir, 'prod-by-name.json'), JSON.stringify(prodByName, null, 2));
fs.writeFileSync(path.join(outputDir, 'monthly-diffs.json'), JSON.stringify(monthlyDiffs, null, 2));
fs.writeFileSync(path.join(outputDir, 'category-diff-details.json'), JSON.stringify(categoryDetails, null, 2));
fs.writeFileSync(path.join(outputDir, 'name-diff-details.json'), JSON.stringify(nameDetails, null, 2));

// Print summary
console.log('\n=== MONTHLY DIFFERENCE SUMMARY ===');
console.log(`Total months with differences: ${new Set(monthlyDiffs.map(d => d.month)).size}`);
console.log(`Total account-month differences: ${monthlyDiffs.length}`);

// Group by account for summary
const byAccount = {};
for (const d of monthlyDiffs) {
  if (!byAccount[d.accountName]) byAccount[d.accountName] = { count: 0, totalAbsDiff: 0 };
  byAccount[d.accountName].count++;
  byAccount[d.accountName].totalAbsDiff += Math.abs(d.diff);
}

console.log('\nDifferences by account:');
for (const [name, stats] of Object.entries(byAccount).sort((a, b) => b[1].totalAbsDiff - a[1].totalAbsDiff)) {
  console.log(`  ${name}: ${stats.count} months differ, total abs diff: $${stats.totalAbsDiff.toFixed(2)}`);
}

// Show first 20 biggest differences
console.log('\nTop 20 biggest monthly differences:');
const sorted = [...monthlyDiffs].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 20);
for (const d of sorted) {
  console.log(`  ${d.month} | ${d.accountName}: dev=$${d.devTotal.toFixed(2)} prod=$${d.prodTotal.toFixed(2)} diff=$${d.diff.toFixed(2)}`);
}

// Show suspicious dev-only patterns (activities in dev but not prod at all)
console.log('\n=== DEV-ONLY CATEGORIES (not in prod at all) ===');
const devOnlyCategories = new Set();
const prodCategories = new Set();
for (const ym of Object.keys(prodByCategory)) {
  for (const acct of Object.values(prodByCategory[ym])) {
    Object.keys(acct.items).forEach(k => prodCategories.add(k));
  }
}
for (const ym of Object.keys(devByCategory)) {
  for (const acct of Object.values(devByCategory[ym])) {
    Object.keys(acct.items).forEach(k => {
      if (!prodCategories.has(k)) devOnlyCategories.add(k);
    });
  }
}
for (const cat of [...devOnlyCategories].sort()) {
  console.log(`  ${cat}`);
}

console.log(`\nOutput files written to: ${outputDir}`);
