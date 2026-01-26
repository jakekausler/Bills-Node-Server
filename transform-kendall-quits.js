const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data/data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// Helper functions
const findAccount = (name) => data.accounts.find(acc => acc.name === name);
const findBill = (account, billName) => {
  return account.bills.find(b => b.name === billName);
};
const findTransferBill = (billName) => {
  return data.transfers.bills.find(b => b.name === billName);
};

// Find accounts
const jakeAccount = findAccount('Jake');
const kendallAccount = findAccount('Kendall');
const kendall401kAccount = findAccount('Kendall 401(k)');
const jake401kAccount = findAccount('Jake 401(k)');

console.log('Starting transformation...');
console.log(`Jake account ID: ${jakeAccount.id}`);
console.log(`Kendall account ID: ${kendallAccount.id}`);
console.log(`Kendall 401(k) account ID: ${kendall401kAccount.id}`);
console.log(`Jake 401(k) account ID: ${jake401kAccount.id}`);

let changes = {
  task2a: 0,
  task2b: 0,
  task2c: 0,
  task2d: 0
};

// =====================================================================
// Task 2A: Set end dates for 8 bills to use KENDALL_QUIT_DATE variable
// =====================================================================
console.log('\n=== Task 2A: Setting end dates for Kendall-related bills ===');

// 1. Kendall Income
const kendallIncome = findBill(kendallAccount, 'Kendall Income');
if (kendallIncome) {
  kendallIncome.endDate = '2026-03-01';
  kendallIncome.endDateIsVariable = true;
  kendallIncome.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: Kendall Income');
  changes.task2a++;
}

// 2. Kendall 401(k) Contribution (find by amount = variable KENDALL_401K_CONTRIBUTION)
const kendall401k = kendall401kAccount.bills.find(b =>
  b.name === 'Kendall 401(k) Contribution' &&
  b.amountVariable === 'KENDALL_401K_CONTRIBUTION'
);
if (kendall401k) {
  kendall401k.endDate = '2026-03-01';
  kendall401k.endDateIsVariable = true;
  kendall401k.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: Kendall 401(k) Contribution');
  changes.task2a++;
}

// 3. Kendall 401(k) Contribution Raise (find by amount = variable KENDALL_401K_CONTRIBUTION_RAISE)
const kendall401kRaise = kendall401kAccount.bills.find(b =>
  b.name === 'Kendall 401(k) Contribution Raise' &&
  b.amountVariable === 'KENDALL_401K_CONTRIBUTION_RAISE'
);
if (kendall401kRaise) {
  kendall401kRaise.endDate = '2026-03-01';
  kendall401kRaise.endDateIsVariable = true;
  kendall401kRaise.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: Kendall 401(k) Contribution Raise');
  changes.task2a++;
}

// 4. Employer Match (find by amount = variable KENDALL_401K_EMPLOYER_MATCH)
const kendallMatch = kendall401kAccount.bills.find(b =>
  b.name === 'Employer Match' &&
  b.amountVariable === 'KENDALL_401K_EMPLOYER_MATCH'
);
if (kendallMatch) {
  kendallMatch.endDate = '2026-03-01';
  kendallMatch.endDateIsVariable = true;
  kendallMatch.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: Kendall Employer Match');
  changes.task2a++;
}

// 5. City of Raleigh Kendall (in Jake's account)
const cityOfRaleigh = findBill(jakeAccount, 'City of Raleigh Kendall');
if (cityOfRaleigh) {
  cityOfRaleigh.endDate = '2026-03-01';
  cityOfRaleigh.endDateIsVariable = true;
  cityOfRaleigh.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: City of Raleigh Kendall');
  changes.task2a++;
}

// 6. Transfer from Kendall to Ben (in Kendall account, not transfers.bills)
const transferToBen = findBill(kendallAccount, 'Transfer from Kendall to Ben');
if (transferToBen) {
  transferToBen.endDate = '2026-03-01';
  transferToBen.endDateIsVariable = true;
  transferToBen.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: Transfer from Kendall to Ben');
  changes.task2a++;
}

// 7. Transfer from Kendall to Costco
const transferToCostco = findTransferBill('Transfer from Kendall to Costco');
if (transferToCostco) {
  transferToCostco.endDate = '2026-03-01';
  transferToCostco.endDateIsVariable = true;
  transferToCostco.endDateVariable = 'KENDALL_QUIT_DATE';
  console.log('✓ Updated: Transfer from Kendall to Costco');
  changes.task2a++;
}

// Note: Transfer from Kendall to Jake doesn't exist yet - it will be created in Task 2B

// =====================================================================
// Task 2B: Add 3 new bills
// =====================================================================
console.log('\n=== Task 2B: Adding new bills ===');

// Generate unique IDs
const generateId = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Bill 1: Jake Healthcare for Kendall Adjustment
const healthcareAdjustment = {
  id: generateId(),
  name: "Jake Healthcare for Kendall Adjustment",
  category: "Healthcare.Insurance",
  isTransfer: false,
  from: null,
  to: null,
  everyN: 2,
  periods: "week",
  increaseBy: 0.03,
  increaseByIsVariable: true,
  increaseByVariable: "INFLATION",
  increaseByDate: "01/01",
  annualStartDate: null,
  annualEndDate: null,
  ceilingMultiple: 0,
  monteCarloSampleType: null,
  isAutomatic: false,
  startDate: "2026-03-01",
  startDateIsVariable: true,
  startDateVariable: "KENDALL_QUIT_DATE",
  endDate: "2055-07-15",
  endDateIsVariable: true,
  endDateVariable: "RETIRE_DATE",
  amount: -200,
  amountIsVariable: true,
  amountVariable: "JAKE_HEALTHCARE_FOR_KENDALL_ADJUSTMENT",
  flagColor: null,
  flag: false,
  isHealthcare: false,
  healthcarePerson: null,
  copayAmount: null,
  coinsurancePercent: null,
  countsTowardDeductible: true,
  countsTowardOutOfPocket: true
};
jakeAccount.bills.push(healthcareAdjustment);
console.log('✓ Added: Jake Healthcare for Kendall Adjustment');
changes.task2b++;

// Bill 2: Jake 401k Offset
// Find Jake's existing 401k bill to match startDate (in Jake 401(k) account)
const jake401kTemp = jake401kAccount.bills.find(b =>
  b.name === '401(k) Contribution' &&
  b.amount === 943
);
const offsetStartDate = jake401kTemp ? jake401kTemp.startDate : '2026-01-23';

const offset401k = {
  id: generateId(),
  name: "Jake 401k Offset",
  category: "Income.Other",
  isTransfer: false,
  from: null,
  to: null,
  everyN: 2,
  periods: "week",
  increaseBy: 0.03,
  increaseByIsVariable: true,
  increaseByVariable: "INFLATION",
  increaseByDate: "01/01",
  annualStartDate: null,
  annualEndDate: null,
  ceilingMultiple: 0,
  monteCarloSampleType: null,
  isAutomatic: false,
  startDate: offsetStartDate,
  startDateIsVariable: false,
  startDateVariable: null,
  endDate: "2055-07-15",
  endDateIsVariable: true,
  endDateVariable: "RETIRE_DATE",
  amount: 550,
  amountIsVariable: true,
  amountVariable: "JAKE_401K_CONTRIBUTION_OFFSET",
  flagColor: null,
  flag: false,
  isHealthcare: false,
  healthcarePerson: null,
  copayAmount: null,
  coinsurancePercent: null,
  countsTowardDeductible: true,
  countsTowardOutOfPocket: true
};
jakeAccount.bills.push(offset401k);
console.log('✓ Added: Jake 401k Offset (startDate matches Jake 401k)');
changes.task2b++;

// Bill 3: Transfer from Jake to Kendall
const transferToKendall = {
  id: generateId(),
  name: "Transfer from Jake to Kendall",
  category: "Ignore.Transfer",
  isTransfer: true,
  from: "Jake",
  to: "Kendall",
  everyN: 1,
  periods: "month",
  increaseBy: 0.03,
  increaseByIsVariable: true,
  increaseByVariable: "INFLATION",
  increaseByDate: "01/01",
  annualStartDate: null,
  annualEndDate: null,
  ceilingMultiple: 0,
  monteCarloSampleType: null,
  isAutomatic: false,
  startDate: "2026-03-01",
  startDateIsVariable: true,
  startDateVariable: "KENDALL_QUIT_DATE",
  endDate: "2055-07-15",
  endDateIsVariable: true,
  endDateVariable: "RETIRE_DATE",
  amount: 725,
  amountIsVariable: true,
  amountVariable: "TRANSFER_TO_KENDALL",
  flagColor: null,
  flag: false,
  isHealthcare: false,
  healthcarePerson: null,
  copayAmount: null,
  coinsurancePercent: null,
  countsTowardDeductible: true,
  countsTowardOutOfPocket: true
};
data.transfers.bills.push(transferToKendall);
console.log('✓ Added: Transfer from Jake to Kendall');
changes.task2b++;

// =====================================================================
// Task 2C: Modify Jake's 401k bills to use variables
// =====================================================================
console.log('\n=== Task 2C: Updating Jake 401k bills ===');

// Find Jake's 401k contribution bill (in Jake 401(k) account)
const jake401k = jake401kAccount.bills.find(b =>
  b.name === '401(k) Contribution' &&
  b.amount === 943
);
if (jake401k) {
  jake401k.amount = 300;
  jake401k.amountIsVariable = true;
  jake401k.amountVariable = 'JAKE_401K_CONTRIBUTION';
  jake401k.endDate = '2055-07-15';
  jake401k.endDateIsVariable = true;
  jake401k.endDateVariable = 'RETIRE_DATE';
  console.log('✓ Updated: Jake 401(k) Contribution (amount and endDate)');
  changes.task2c++;
}

// Find Jake's Employer Match (in Jake 401(k) account)
const jakeMatch = jake401kAccount.bills.find(b =>
  b.name === 'Employer Match'
);
if (jakeMatch) {
  jakeMatch.endDate = '2055-07-15';
  jakeMatch.endDateIsVariable = true;
  jakeMatch.endDateVariable = 'RETIRE_DATE';
  console.log('✓ Updated: Jake Employer Match (endDate)');
  changes.task2c++;
}

// =====================================================================
// Task 2D: Remove OpenAI bill
// =====================================================================
console.log('\n=== Task 2D: Removing OpenAI bill ===');

// Search all accounts for OpenAI bill
let openAIRemoved = false;
for (const account of data.accounts) {
  const openAIIndex = account.bills.findIndex(b => b.name === 'OpenAI');
  if (openAIIndex !== -1) {
    account.bills.splice(openAIIndex, 1);
    console.log(`✓ Removed: OpenAI bill from ${account.name} account`);
    changes.task2d++;
    openAIRemoved = true;
    break;
  }
}

if (!openAIRemoved) {
  console.log('⚠ Warning: OpenAI bill not found in any account');
}

// =====================================================================
// Write back to file
// =====================================================================
console.log('\n=== Writing changes to data.json ===');
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf8');
console.log('✓ File written successfully');

// =====================================================================
// Summary
// =====================================================================
console.log('\n=== Transformation Summary ===');
console.log(`Task 2A - End dates set to KENDALL_QUIT_DATE: ${changes.task2a} bills`);
console.log(`Task 2B - New bills added: ${changes.task2b} bills`);
console.log(`Task 2C - Jake 401k bills updated: ${changes.task2c} bills`);
console.log(`Task 2D - Bills removed: ${changes.task2d} bills`);
console.log(`Total changes: ${Object.values(changes).reduce((a, b) => a + b, 0)}`);
console.log('\n✓ Transformation complete!');
