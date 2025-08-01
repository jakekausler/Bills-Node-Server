#!/usr/bin/env node

import { spawn } from 'child_process';

interface ParsedLogEntry {
  mainText: string;
  columns: string[];
}

function parseLogLine(line: string): ParsedLogEntry {
  // Remove all bracketed sections to get the remaining text
  const withoutBrackets = line.replace(/\[[^\]]+\]/g, '').trim();

  // Split by pipe to get columns
  const parts = withoutBrackets.split('|').map(part => part.trim());
  const mainText = parts[0] || '';
  const columns = parts.slice(1);

  return {
    mainText,
    columns
  };
}

function formatTable(entries: ParsedLogEntry[], useColors: boolean = true): void {
  if (entries.length === 0) return;

  // ANSI color codes for different columns
  const colors = [
    '\x1b[36m', // Cyan
    '\x1b[33m', // Yellow  
    '\x1b[32m', // Green
    '\x1b[35m', // Magenta
    '\x1b[34m', // Blue
    '\x1b[31m', // Red
    '\x1b[37m', // White
    '\x1b[90m', // Bright Black (Gray)
  ];
  const reset = '\x1b[0m';
  const mainTextColor = '\x1b[97m'; // Bright white for main text

  const maxMainTextWidth = Math.max(...entries.map(e => e.mainText.length));

  // Find the maximum number of columns across all entries
  const maxColumns = Math.max(...entries.map(e => e.columns.length));

  // Calculate width for each column position individually
  // Only consider entries that have the maximum number of columns
  // Exclude the last column from width calculation since it spans remaining space
  const fullRowEntries = entries.filter(e => e.columns.length === maxColumns);
  const columnWidths: number[] = [];

  for (let i = 0; i < maxColumns; i++) {
    if (i === maxColumns - 1) {
      // Last column - doesn't matter what width we set, it will span remaining space
      columnWidths.push(0);
      // } else if (fullRowEntries.length > 0) {
      //   // Calculate width for this specific column position from full rows
      //   const widthForThisColumn = Math.max(...fullRowEntries.map(e => e.columns[i]?.length || 0));
      //   columnWidths.push(widthForThisColumn);
      // } else {
      //   // Fallback: calculate from any entry that has this column position
      //   const widthsForColumn = entries
      //     .filter(e => e.columns.length > i)
      //     .map(e => e.columns[i]?.length || 0);
      //   columnWidths.push(widthsForColumn.length > 0 ? Math.max(...widthsForColumn) : 0);
      // }
    } else {
      const cellWidths = entries.map(e => e.columns.length - 1 > i ? e.columns[i]?.length || 0 : 0);
      columnWidths.push(Math.max(...cellWidths));
    }
  }

  // Print header separator
  const totalWidth = maxMainTextWidth + 3 +
    columnWidths.reduce((sum, w) => sum + w + 3, 0);
  console.log('─'.repeat(totalWidth));

  // Print each entry
  entries.forEach(entry => {
    const coloredMainText = useColors ? `${mainTextColor}${entry.mainText}${reset}` : entry.mainText;
    const paddedMainText = coloredMainText + ' '.repeat(Math.max(0, maxMainTextWidth - entry.mainText.length));

    let row = `${paddedMainText}`;

    // Add columns
    if (entry.columns.length === 0) {
      // No columns, fill remaining space
      const remainingWidth = columnWidths.reduce((sum, w) => sum + w + 3, 0);
      if (remainingWidth > 0) {
        row += ' │ ' + ' '.repeat(remainingWidth - 3);
      }
    } else {
      for (let i = 0; i < maxColumns; i++) {
        if (i < entry.columns.length - 1) {
          // Normal column - use individual width
          const columnValue = entry.columns[i] || '';
          const color = colors[i % colors.length];
          const coloredColumn = useColors ? `${color}${columnValue}${reset}` : columnValue;
          const paddedColumn = coloredColumn + ' '.repeat(Math.max(0, columnWidths[i] - columnValue.length));
          row += ` │ ${paddedColumn}`;
        } else if (i === entry.columns.length - 1) {
          // Last column for this entry - fill remaining space
          const columnValue = entry.columns[i] || '';
          const remainingWidth = columnWidths.slice(i).reduce((sum, w) => sum + w + 3, 0) - 3;
          const color = colors[i % colors.length];
          const coloredColumn = useColors ? `${color}${columnValue}${reset}` : columnValue;
          const paddedColumn = coloredColumn + ' '.repeat(Math.max(0, remainingWidth - columnValue.length));
          row += ` │ ${paddedColumn}`;
          break; // Don't process more columns
        } else {
          // This entry doesn't have this column, skip
          break;
        }
      }
    }

    console.log(row);
  });

  // Print footer separator
  console.log('─'.repeat(totalWidth));
}

async function processInput(): Promise<void> {
  const args = process.argv.slice(2);

  // Check for --no-colors flag
  const noColorsIndex = args.findIndex(arg => arg === '--no-colors');
  const useColors = noColorsIndex === -1;

  // Remove --no-colors from grep args
  const grepArgs = noColorsIndex >= 0
    ? args.filter((_, index) => index !== noColorsIndex)
    : args;

  if (grepArgs.length === 0) {
    console.error('Usage: log-reader.ts [--no-colors] <grep-options-and-pattern>');
    console.error('Example: log-reader.ts --color="never" "current_to_near_future.*ba1af043"');
    console.error('Example: log-reader.ts --no-colors "pattern"');
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    // Spawn grep with the provided arguments
    const grep = spawn('grep', grepArgs, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let grepOutput = '';
    let grepError = '';

    // Pipe stdin to grep
    process.stdin.pipe(grep.stdin);

    // Collect grep output
    grep.stdout.on('data', (data) => {
      grepOutput += data.toString();
    });

    grep.stderr.on('data', (data) => {
      grepError += data.toString();
    });

    grep.on('close', (code) => {
      if (code !== 0 && code !== 1) { // grep returns 1 when no matches found
        console.error('grep error:', grepError);
        reject(new Error(`grep exited with code ${code}`));
        return;
      }

      // Parse grep output
      const lines = grepOutput.trim().split('\n').filter(line => line.length > 0);
      const entries = lines.map(parseLogLine);

      // Format and display table
      formatTable(entries, useColors);
      resolve();
    });

    grep.on('error', (err) => {
      reject(err);
    });
  });
}

// Handle process
if (import.meta.url === `file://${process.argv[1]}`) {
  processInput().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { parseLogLine, formatTable };
