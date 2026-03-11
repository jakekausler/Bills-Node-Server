import { HealthcareConfig, HealthcareConfigsData } from '../../data/healthcare/types';
import { load, save, checkExists } from './io';

const HEALTHCARE_CONFIGS_FILE = 'healthcare_configs.json';

export function loadHealthcareConfigs(): HealthcareConfig[] {
  try {
    const data = load<HealthcareConfigsData>(HEALTHCARE_CONFIGS_FILE);
    return data.configs || [];
  } catch (error) {
    // If file doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export function saveHealthcareConfigs(configs: HealthcareConfig[]): void {
  const data: HealthcareConfigsData = { configs };
  save(data, HEALTHCARE_CONFIGS_FILE);
}
