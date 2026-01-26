#!/usr/bin/env node

/**
 * Variables Extraction Script
 *
 * Extracts all variables from Bills application variables.csv files.
 *
 * CSV Structure:
 * - First column: variable name
 * - Second column: "Default" simulation values
 * - Third+ columns: Other simulation values (e.g., "Kendall Low Pay")
 *
 * This script extracts variables from the "Default" simulation (second column).
 *
 * Usage: node extract-variables.js <path-to-variables.csv>
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Error: Please provide a path to variables.csv file');
  console.error('Usage: node extract-variables.js <path-to-variables.csv>');
  process.exit(1);
}

const csvFilePath = args[0];

// Check if file exists
if (!fs.existsSync(csvFilePath)) {
  console.error(`Error: File not found: ${csvFilePath}`);
  process.exit(1);
}

try {
  // Read and parse the CSV file
  console.log(`Reading variables from: ${csvFilePath}\n`);
  const rawData = fs.readFileSync(csvFilePath, 'utf8');

  // Split into lines
  const lines = rawData.trim().split('\n');

  if (lines.length === 0) {
    console.error('Error: CSV file is empty');
    process.exit(1);
  }

  // Parse header row to get simulation names
  const headerRow = lines[0].split(',');
  const simulations = headerRow.slice(1); // Skip first column (variable name)

  console.log('Available simulations:', simulations.join(', '));
  console.log('\nExtracting variables from "Default" simulation...\n');

  // Find the index of the "Default" column (should be index 1, but let's be safe)
  const defaultColumnIndex = simulations.indexOf('Default') + 1; // +1 because we skip variable name column

  if (defaultColumnIndex === 0) {
    console.error('Error: Could not find "Default" simulation in CSV');
    console.error('Available simulations:', simulations.join(', '));
    process.exit(1);
  }

  // Parse variables
  const variables = {};
  const variablesList = [];

  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split(',');
    const variableName = columns[0];
    const defaultValue = columns[defaultColumnIndex];

    if (variableName && defaultValue !== undefined) {
      variables[variableName] = defaultValue;
      variablesList.push({
        name: variableName,
        value: defaultValue,
        type: inferType(defaultValue)
      });
    }
  }

  // Display results
  console.log('='.repeat(80));
  console.log('VARIABLES EXTRACTION REPORT (Default Simulation)');
  console.log('='.repeat(80));
  console.log(`\nTotal Variables: ${variablesList.length}\n`);

  // Group variables by type
  const byType = {
    date: [],
    number: [],
    rate: [],
    currency: [],
    other: []
  };

  variablesList.forEach(variable => {
    if (!byType[variable.type]) {
      byType[variable.type] = [];
    }
    byType[variable.type].push(variable);
  });

  // Display by category
  const categories = [
    { key: 'date', label: 'DATE VARIABLES', format: (v) => v },
    { key: 'rate', label: 'RATE VARIABLES (percentages)', format: (v) => `${(parseFloat(v) * 100).toFixed(2)}%` },
    { key: 'currency', label: 'CURRENCY VARIABLES', format: (v) => `$${parseFloat(v).toFixed(2)}` },
    { key: 'number', label: 'NUMERIC VARIABLES', format: (v) => v },
    { key: 'other', label: 'OTHER VARIABLES', format: (v) => v }
  ];

  categories.forEach(category => {
    if (byType[category.key].length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log(category.label);
      console.log('='.repeat(80));

      byType[category.key].forEach(variable => {
        const formattedValue = category.format(variable.value);
        console.log(`  ${variable.name.padEnd(40)} = ${formattedValue}`);
      });
    }
  });

  // Display all variables in alphabetical order
  console.log('\n' + '='.repeat(80));
  console.log('ALL VARIABLES (Alphabetical)');
  console.log('='.repeat(80));

  const sortedVariables = [...variablesList].sort((a, b) => a.name.localeCompare(b.name));
  sortedVariables.forEach(variable => {
    console.log(`  ${variable.name.padEnd(40)} = ${variable.value}`);
  });

  console.log('\n' + '='.repeat(80));
  console.log('END OF REPORT');
  console.log('='.repeat(80) + '\n');

  // Output as JSON
  try {
    const outputPath = path.join(path.dirname(csvFilePath), 'extracted-variables.json');
    fs.writeFileSync(outputPath, JSON.stringify({
      simulation: 'Default',
      variables: variables,
      variablesList: variablesList,
      summary: {
        total: variablesList.length,
        byType: {
          date: byType.date.length,
          rate: byType.rate.length,
          currency: byType.currency.length,
          number: byType.number.length,
          other: byType.other.length
        }
      }
    }, null, 2));
    console.log(`JSON output saved to: ${outputPath}\n`);
  } catch (writeError) {
    console.log(`\nNote: Could not write JSON file (${writeError.message})`);
    console.log('You can redirect output to a file manually if needed.\n');
  }

} catch (error) {
  console.error('Error processing file:', error.message);
  process.exit(1);
}

/**
 * Infer the type of a variable value
 */
function inferType(value) {
  // Check for date format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return 'date';
  }

  // Try to parse as number
  const num = parseFloat(value);
  if (isNaN(num)) {
    return 'other';
  }

  // Check if it's a rate (between 0 and 1, typically)
  if (num > 0 && num < 1) {
    return 'rate';
  }

  // Check if it's currency (large negative or positive number)
  if (Math.abs(num) > 100) {
    return 'currency';
  }

  return 'number';
}
