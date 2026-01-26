#!/usr/bin/env node

/**
 * Bill Extraction Script
 *
 * Extracts all bills from Bills application data.json files.
 *
 * Data Structure:
 * - Top level has "accounts" array and "transfers" object
 * - Each account in accounts[] has:
 *   - name: account name
 *   - bills: array of recurring bills for that account
 * - transfers object has:
 *   - activity: array of one-time transfers (with "date" field)
 *   - bills: array of recurring transfer bills (with "everyN" and "periods" fields)
 *
 * Usage: node extract-bills.js <path-to-data.json>
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Error: Please provide a path to data.json file');
  console.error('Usage: node extract-bills.js <path-to-data.json>');
  process.exit(1);
}

const dataFilePath = args[0];

// Check if file exists
if (!fs.existsSync(dataFilePath)) {
  console.error(`Error: File not found: ${dataFilePath}`);
  process.exit(1);
}

try {
  // Read and parse the JSON file
  console.log(`Reading data from: ${dataFilePath}\n`);
  const rawData = fs.readFileSync(dataFilePath, 'utf8');
  const data = JSON.parse(rawData);

  const allBills = {
    accountBills: [],
    transferBills: []
  };

  // Extract bills from each account
  if (data.accounts && Array.isArray(data.accounts)) {
    data.accounts.forEach(account => {
      if (account.bills && Array.isArray(account.bills)) {
        account.bills.forEach(bill => {
          allBills.accountBills.push({
            accountName: account.name,
            accountId: account.id,
            billId: bill.id,
            name: bill.name,
            category: bill.category,
            amount: bill.amount,
            amountVariable: bill.amountIsVariable ? bill.amountVariable : null,
            frequency: `Every ${bill.everyN} ${bill.periods}`,
            startDate: bill.startDate,
            endDate: bill.endDate || 'None',
            increaseBy: bill.increaseBy,
            increaseByVariable: bill.increaseByIsVariable ? bill.increaseByVariable : null,
            isTransfer: bill.isTransfer,
            from: bill.from,
            to: bill.to,
            isAutomatic: bill.isAutomatic,
            flag: bill.flag,
            flagColor: bill.flagColor,
            isHealthcare: bill.isHealthcare,
            healthcarePerson: bill.healthcarePerson
          });
        });
      }
    });
  }

  // Extract bills from transfers (transfers.bills array)
  if (data.transfers && data.transfers.bills && Array.isArray(data.transfers.bills)) {
    data.transfers.bills.forEach(bill => {
      allBills.transferBills.push({
        billId: bill.id,
        name: bill.name,
        category: bill.category,
        amount: bill.amount,
        amountVariable: bill.amountIsVariable ? bill.amountVariable : null,
        frequency: `Every ${bill.everyN} ${bill.periods}`,
        startDate: bill.startDate,
        endDate: bill.endDate || 'None',
        increaseBy: bill.increaseBy,
        increaseByVariable: bill.increaseByIsVariable ? bill.increaseByVariable : null,
        isTransfer: bill.isTransfer,
        from: bill.from,
        to: bill.to,
        isAutomatic: bill.isAutomatic,
        flag: bill.flag,
        flagColor: bill.flagColor,
        isHealthcare: bill.isHealthcare,
        healthcarePerson: bill.healthcarePerson
      });
    });
  }

  // Display results
  console.log('='.repeat(80));
  console.log('BILLS EXTRACTION REPORT');
  console.log('='.repeat(80));
  console.log(`\nTotal Account Bills: ${allBills.accountBills.length}`);
  console.log(`Total Transfer Bills: ${allBills.transferBills.length}`);
  console.log(`Total Bills: ${allBills.accountBills.length + allBills.transferBills.length}\n`);

  // Display account bills
  if (allBills.accountBills.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('ACCOUNT BILLS');
    console.log('='.repeat(80));

    allBills.accountBills.forEach((bill, index) => {
      console.log(`\n[${index + 1}] ${bill.name}`);
      console.log(`    Account: ${bill.accountName}`);
      console.log(`    Category: ${bill.category}`);
      console.log(`    Amount: ${bill.amount}${bill.amountVariable ? ` (Variable: ${bill.amountVariable})` : ''}`);
      console.log(`    Frequency: ${bill.frequency}`);
      console.log(`    Start Date: ${bill.startDate}`);
      console.log(`    End Date: ${bill.endDate}`);
      if (bill.increaseBy !== undefined && bill.increaseBy !== 0) {
        console.log(`    Increase By: ${bill.increaseBy}${bill.increaseByVariable ? ` (Variable: ${bill.increaseByVariable})` : ''}`);
      }
      if (bill.isTransfer) {
        console.log(`    Transfer: ${bill.from} -> ${bill.to}`);
      }
      if (bill.isAutomatic) {
        console.log(`    Automatic: Yes`);
      }
      if (bill.flag) {
        console.log(`    Flagged: ${bill.flagColor || 'Yes'}`);
      }
      if (bill.isHealthcare) {
        console.log(`    Healthcare: ${bill.healthcarePerson || 'Yes'}`);
      }
    });
  }

  // Display transfer bills
  if (allBills.transferBills.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('TRANSFER BILLS');
    console.log('='.repeat(80));

    allBills.transferBills.forEach((bill, index) => {
      console.log(`\n[${index + 1}] ${bill.name}`);
      console.log(`    Category: ${bill.category}`);
      console.log(`    Amount: ${bill.amount}${bill.amountVariable ? ` (Variable: ${bill.amountVariable})` : ''}`);
      console.log(`    Frequency: ${bill.frequency}`);
      console.log(`    Start Date: ${bill.startDate}`);
      console.log(`    End Date: ${bill.endDate}`);
      if (bill.increaseBy !== undefined && bill.increaseBy !== 0) {
        console.log(`    Increase By: ${bill.increaseBy}${bill.increaseByVariable ? ` (Variable: ${bill.increaseByVariable})` : ''}`);
      }
      if (bill.isTransfer) {
        console.log(`    Transfer: ${bill.from} -> ${bill.to}`);
      }
      if (bill.isAutomatic) {
        console.log(`    Automatic: Yes`);
      }
      if (bill.flag) {
        console.log(`    Flagged: ${bill.flagColor || 'Yes'}`);
      }
      if (bill.isHealthcare) {
        console.log(`    Healthcare: ${bill.healthcarePerson || 'Yes'}`);
      }
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('END OF REPORT');
  console.log('='.repeat(80) + '\n');

  // Optionally output as JSON to file
  try {
    const outputPath = path.join(path.dirname(dataFilePath), 'extracted-bills.json');
    fs.writeFileSync(outputPath, JSON.stringify(allBills, null, 2));
    console.log(`\nJSON output saved to: ${outputPath}\n`);
  } catch (writeError) {
    console.log(`\nNote: Could not write JSON file (${writeError.message})`);
    console.log('You can redirect output to a file manually if needed.\n');
  }

} catch (error) {
  console.error('Error processing file:', error.message);
  if (error.message.includes('JSON')) {
    console.error('The file does not appear to be valid JSON.');
  }
  process.exit(1);
}
