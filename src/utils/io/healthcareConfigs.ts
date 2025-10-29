import fs from 'fs/promises';
import path from 'path';
import { HealthcareConfig, HealthcareConfigsData } from '../../data/healthcare/types';

const HEALTHCARE_CONFIGS_PATH = path.join(__dirname, 'data', 'healthcare_configs.json');

export async function loadHealthcareConfigs(): Promise<HealthcareConfig[]> {
  try {
    const data = await fs.readFile(HEALTHCARE_CONFIGS_PATH, 'utf-8');
    const parsed: HealthcareConfigsData = JSON.parse(data);
    return parsed.configs || [];
  } catch (error) {
    // If file doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function saveHealthcareConfigs(configs: HealthcareConfig[]): Promise<void> {
  const data: HealthcareConfigsData = { configs };
  await fs.writeFile(HEALTHCARE_CONFIGS_PATH, JSON.stringify(data, null, 2), 'utf-8');
}
