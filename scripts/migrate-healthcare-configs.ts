#!/usr/bin/env node

/**
 * Migration Script: Healthcare Config Data Structure Update
 *
 * Purpose: Convert healthcare_configs.json from single personName to coveredPersons array
 *
 * Before: { personName: "Jake", ... }
 * After:  { coveredPersons: ["Jake"], ... }
 *
 * This script is idempotent and safe to run multiple times.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OldHealthcareConfig {
  id: string;
  name: string;
  personName: string;
  startDate: string;
  endDate: string | null;
  individualDeductible: number;
  individualOutOfPocketMax: number;
  familyDeductible: number;
  familyOutOfPocketMax: number;
  hsaAccountId: string | null;
  hsaReimbursementEnabled: boolean;
  resetMonth: number;
  resetDay: number;
}

interface NewHealthcareConfig {
  id: string;
  name: string;
  coveredPersons: string[];
  startDate: string;
  endDate: string | null;
  individualDeductible: number;
  individualOutOfPocketMax: number;
  familyDeductible: number;
  familyOutOfPocketMax: number;
  hsaAccountId: string | null;
  hsaReimbursementEnabled: boolean;
  resetMonth: number;
  resetDay: number;
}

interface HealthcareConfigFile {
  configs: (OldHealthcareConfig | NewHealthcareConfig)[];
}

const DATA_FILE_PATH = path.join(__dirname, '../data/healthcare_configs.json');

function hasOldFormat(config: OldHealthcareConfig | NewHealthcareConfig): config is OldHealthcareConfig {
  return 'personName' in config;
}

function hasNewFormat(config: OldHealthcareConfig | NewHealthcareConfig): config is NewHealthcareConfig {
  return 'coveredPersons' in config;
}

function migrateConfig(config: OldHealthcareConfig | NewHealthcareConfig): NewHealthcareConfig {
  if (hasNewFormat(config)) {
    // Already migrated, return as-is
    return config;
  }

  if (hasOldFormat(config)) {
    // Migrate from old format
    const { personName, ...rest } = config;
    return {
      ...rest,
      coveredPersons: [personName]
    };
  }

  // Should never reach here, but TypeScript needs this
  throw new Error('Config has neither old nor new format');
}

function main(): void {
  console.log('Starting healthcare config migration...');
  console.log(`Reading file: ${DATA_FILE_PATH}`);

  // Check if file exists
  if (!fs.existsSync(DATA_FILE_PATH)) {
    console.error(`Error: File not found at ${DATA_FILE_PATH}`);
    process.exit(1);
  }

  // Read the file
  let fileContent: string;
  try {
    fileContent = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
  } catch (error) {
    console.error('Error reading file:', error);
    process.exit(1);
  }

  // Parse JSON
  let data: HealthcareConfigFile;
  try {
    data = JSON.parse(fileContent);
  } catch (error) {
    console.error('Error parsing JSON:', error);
    process.exit(1);
  }

  // Check structure
  if (!data.configs || !Array.isArray(data.configs)) {
    console.error('Error: Invalid file structure. Expected { configs: [] }');
    process.exit(1);
  }

  if (data.configs.length === 0) {
    console.log('No configs found in file. Nothing to migrate.');
    process.exit(0);
  }

  // Count configs that need migration
  const configsToMigrate = data.configs.filter(hasOldFormat);
  const alreadyMigrated = data.configs.filter(hasNewFormat);

  console.log(`Found ${data.configs.length} total configs`);
  console.log(`  - ${configsToMigrate.length} need migration (have personName)`);
  console.log(`  - ${alreadyMigrated.length} already migrated (have coveredPersons)`);

  if (configsToMigrate.length === 0) {
    console.log('\nAll configs already migrated. Nothing to do.');
    process.exit(0);
  }

  // Migrate all configs
  const migratedData: HealthcareConfigFile = {
    configs: data.configs.map(migrateConfig)
  };

  // Create backup before modifying
  const backupPath = DATA_FILE_PATH + `.backup-${Date.now()}`;
  try {
    fs.copyFileSync(DATA_FILE_PATH, backupPath);
    console.log(`\n✓ Created backup: ${backupPath}`);
  } catch (error) {
    console.error('Error creating backup:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Write back to file with pretty printing
  try {
    fs.writeFileSync(
      DATA_FILE_PATH,
      JSON.stringify(migratedData, null, 2) + '\n',
      'utf-8'
    );
    console.log(`✓ Successfully migrated ${configsToMigrate.length} configs from personName to coveredPersons`);
    console.log(`✓ Updated file: ${DATA_FILE_PATH}`);
  } catch (error) {
    console.error('Error writing file:', error);
    process.exit(1);
  }
}

// Run the migration
main();
