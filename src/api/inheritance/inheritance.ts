import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import type { BenefactorConfig } from '../../utils/calculate-v3/inheritance-manager';

const CONFIG_FILE = 'inheritanceConfig.json';

function loadConfigs(): BenefactorConfig[] {
  try {
    return load<BenefactorConfig[]>(CONFIG_FILE);
  } catch {
    return [];
  }
}

function saveConfigs(configs: BenefactorConfig[]): void {
  save(configs, CONFIG_FILE);
}

export async function getInheritanceConfigs(_req: Request) {
  return loadConfigs();
}

export async function updateInheritanceConfigs(req: Request) {
  const configs = req.body as BenefactorConfig[];
  saveConfigs(configs);
  return configs;
}
