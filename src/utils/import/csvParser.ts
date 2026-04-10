/**
 * Parses a CSV file and returns headers, rows, and malformed row tracking.
 *
 * Handles:
 * - UTF-8 BOM at file start
 * - Quoted fields with commas and escaped quotes
 * - Validates that first row is a valid header row
 * - Tracks malformed rows (column count mismatch)
 */

interface ParseResult {
  headers: string[];
  rows: string[][];
  malformedRows: { line: number; content: string }[];
}

/**
 * Parses a CSV string into headers and rows
 */
export function parseCSV(fileContent: string): ParseResult {
  // Remove UTF-8 BOM if present
  let content = fileContent;
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  // Split into lines (handle both \r\n and \n)
  const lines = content.split(/\r?\n/);

  // Remove empty trailing lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  // Validate line 1 is a header row
  const headerLine = lines[0];
  const headerFields = parseCSVLine(headerLine);

  if (headerFields.length === 0) {
    throw new Error('CSV must start with a header row. Please remove any frontmatter before uploading.');
  }

  // Check first cell is not empty and starts with a letter
  const firstCell = headerFields[0];
  if (!firstCell || !firstCell.match(/^[a-zA-Z]/)) {
    throw new Error('CSV must start with a header row. Please remove any frontmatter before uploading.');
  }

  const headers = headerFields;
  const malformedRows: { line: number; content: string }[] = [];
  const rows: string[][] = [];

  // Parse remaining lines as data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') {
      continue;
    }

    const fields = parseCSVLine(line);

    // Check if row has correct number of columns
    if (fields.length !== headers.length) {
      malformedRows.push({
        line: i + 1, // 1-indexed line number for user display
        content: line,
      });
      continue;
    }

    rows.push(fields);
  }

  return {
    headers,
    rows,
    malformedRows,
  };
}

/**
 * Parses a single CSV line handling quoted fields and escaped quotes
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote within quoted field
        current += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // Field delimiter
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  // Add final field
  fields.push(current.trim());

  return fields;
}
