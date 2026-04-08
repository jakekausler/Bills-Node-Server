import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import type { RateConfig } from './types';
import { ApiError } from '../errors';

const CONFIG_FILE = 'ratesConfig.json';

export const KNOWN_RATES = [
  'INFLATION',
  'HEALTHCARE_INFLATION',
  'HOME_APPRECIATION',
  'STOCK_RETURN',
  'BOND_RETURN',
  'CASH_RETURN',
  'INVESTMENT_RATE',
  'HIGH_YIELD_SAVINGS_RATE',
  'LOW_YIELD_SAVINGS_RATE',
  'RAISE_RATE',
  'SS_COLA_RATE',
  '401K_LIMIT_INCREASE_RATE',
] as const;

// ─── Private Helpers ───

function loadRatesConfig(): RateConfig[] {
  try {
    return load<RateConfig[]>(CONFIG_FILE);
  } catch {
    return [];
  }
}

function saveRatesConfig(data: RateConfig[]): void {
  save(data, CONFIG_FILE);
}

function validateRateConfig(rate: Record<string, unknown>): void {
  if (!rate.name || typeof rate.name !== 'string') {
    throw new ApiError('name is required and must be a string', 400);
  }
  if (!(KNOWN_RATES as readonly string[]).includes(rate.name)) {
    throw new ApiError(`Unknown rate name: "${rate.name}"`, 400);
  }
  if (typeof rate.value !== 'number') {
    throw new ApiError(`value for "${rate.name}" must be a number`, 400);
  }
  if (!rate.description || typeof rate.description !== 'string') {
    throw new ApiError(`description for "${rate.name}" is required and must be a string`, 400);
  }
}

// ─── Public API Helpers ───

export function getRates(): RateConfig[] {
  return loadRatesConfig();
}

export function getRate(name: string): number {
  const rates = loadRatesConfig();
  const rate = rates.find(r => r.name === name);
  if (!rate) throw new Error(`Unknown rate: ${name}`);
  return rate.value;
}

export function getRateNames(): string[] {
  return loadRatesConfig().map(r => r.name);
}

export function isRate(name: string): boolean {
  return (KNOWN_RATES as readonly string[]).includes(name);
}

// ─── CRUD Handlers ───

export async function getRatesConfigHandler(_req: Request): Promise<RateConfig[]> {
  return loadRatesConfig();
}

export async function updateRatesConfigHandler(req: Request): Promise<RateConfig[]> {
  const updates = req.body as RateConfig[];
  if (!Array.isArray(updates) || updates.length !== KNOWN_RATES.length) {
    throw new ApiError(`Rates config must contain exactly ${KNOWN_RATES.length} rate objects`, 400);
  }
  for (const rate of updates) {
    validateRateConfig(rate as unknown as Record<string, unknown>);
  }
  const providedNames = updates.map(r => r.name);
  for (const knownName of KNOWN_RATES) {
    if (!providedNames.includes(knownName)) {
      throw new ApiError(`Missing required rate: "${knownName}"`, 400);
    }
  }
  saveRatesConfig(updates);
  return updates;
}
