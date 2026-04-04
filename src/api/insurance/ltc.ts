import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import type { LTCConfig, LTCTransitionData } from '../../utils/calculate-v3/mortality-manager';

const CONFIG_FILE = 'ltcConfig.json';
const TRANSITIONS_FILE = 'ltcTransitions.json';

function loadConfigs(): LTCConfig[] {
  try {
    return load<LTCConfig[]>(CONFIG_FILE);
  } catch {
    return [];
  }
}

function saveConfigs(configs: LTCConfig[]): void {
  save(configs, CONFIG_FILE);
}

function loadTransitions(): LTCTransitionData {
  try {
    return load<LTCTransitionData>(TRANSITIONS_FILE);
  } catch {
    return {};
  }
}

function saveTransitions(data: LTCTransitionData): void {
  save(data, TRANSITIONS_FILE);
}

export async function getLTCConfigs(_req: Request) {
  return loadConfigs();
}

export async function updateLTCConfigs(req: Request) {
  const configs = req.body as LTCConfig[];
  saveConfigs(configs);
  return configs;
}

export async function getLTCTransitions(_req: Request) {
  return loadTransitions();
}

export async function updateLTCTransitions(req: Request) {
  const data = req.body as LTCTransitionData;
  saveTransitions(data);
  return data;
}
