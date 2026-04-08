import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import { ApiError } from '../errors';
import type { MCMapping } from './types';
import { MonteCarloSampleType } from '../../utils/calculate-v3/types';
import { isRate } from '../rates-config/rates-config';

const SAMPLE_TYPE_DESCRIPTIONS: Record<string, string> = {
  'HYSA': 'High-yield savings account interest rate',
  'LYSA': 'Low-yield savings account interest rate',
  'Portfolio': 'Weighted average return across portfolio asset classes',
  'Inflation': 'General inflation rate (CPI)',
  'HealthcareInflation': 'Healthcare-specific inflation rate',
  'Raise': 'Annual salary increase rate',
  '401k_limit_increase_rate': '401(k) contribution limit annual increase rate',
  'SS_COLA': 'Social Security cost-of-living adjustment rate',
  'SS_WAGE_BASE_CHANGE': 'Social Security wage base change multiplier',
  'K401_LIMIT_CHANGE': '401(k) limit change multiplier',
  'IRA_LIMIT_CHANGE': 'IRA contribution limit change multiplier',
  'HSA_LIMIT_CHANGE': 'HSA contribution limit change multiplier',
  'AWI_GROWTH': 'Average Wage Index growth multiplier',
  'UnemploymentRate': 'Unemployment rate percentage',
  'UnemploymentDuration': 'Median unemployment duration in weeks',
  'StockReturn': 'Annual stock market return rate',
  'BondReturn': 'Annual bond market return rate',
  'CashReturn': 'Cash equivalent return rate',
  'PreferredReturn': 'Preferred stock/security return rate',
  'ConvertibleReturn': 'Convertible security return rate',
  'OtherReturn': 'Other asset class return rate',
  'homeAppreciation': 'Real estate appreciation rate',
  'TermLifePPI': 'Term life insurance price increase rate',
  'WholeLifePPI': 'Whole life insurance price increase rate',
  'WholeLifeDividend': 'Whole life insurance dividend scale rate',
};

// ─── Private Helpers ───

const CONFIG_FILE = 'monteCarloMappings.json';

// Load raw mappings: { "INFLATION": "Inflation", ... }
function loadMCMappings(): Record<string, string> {
  try {
    return load<Record<string, string>>(CONFIG_FILE);
  } catch {
    return {};
  }
}

function saveMCMappings(mappings: Record<string, string>): void {
  save(mappings, CONFIG_FILE);
}

// ─── Public Helpers ───

export function getMCMappings(): MCMapping[] {
  const rawMappings = loadMCMappings();
  // Invert: raw is variable→sampleType, we need sampleType→variable
  const sampleTypeToVariable: Record<string, string> = {};
  for (const [variable, sampleType] of Object.entries(rawMappings)) {
    sampleTypeToVariable[sampleType] = variable;
  }

  // Build array of all 25 sample types
  return Object.values(MonteCarloSampleType).map(st => ({
    sampleType: st,
    variable: sampleTypeToVariable[st] ?? null,
    description: SAMPLE_TYPE_DESCRIPTIONS[st] ?? '',
  }));
}

// ─── CRUD Handlers ───

export async function getMCMappingsHandler(_req: Request): Promise<MCMapping[]> {
  return getMCMappings();
}

export async function updateMCMappingsHandler(req: Request): Promise<MCMapping[]> {
  const updates = req.body as MCMapping[];
  if (!Array.isArray(updates)) {
    throw new ApiError('Request body must be an array of MCMapping objects', 400);
  }

  // Validate each mapping
  for (const mapping of updates) {
    if (!mapping.sampleType || typeof mapping.sampleType !== 'string') {
      throw new ApiError('Each mapping must have a sampleType string', 400);
    }
    // Validate sampleType is a known enum value
    if (!Object.values(MonteCarloSampleType).includes(mapping.sampleType as MonteCarloSampleType)) {
      throw new ApiError(`Unknown sample type: "${mapping.sampleType}"`, 400);
    }
    // Validate variable is a known rate or null
    if (mapping.variable !== null && mapping.variable !== undefined) {
      if (typeof mapping.variable !== 'string') {
        throw new ApiError(`Variable for "${mapping.sampleType}" must be a string or null`, 400);
      }
      if (!isRate(mapping.variable)) {
        throw new ApiError(`Unknown rate variable: "${mapping.variable}"`, 400);
      }
    }
  }

  // Build raw mappings (variable→sampleType format for monteCarloMappings.json)
  const rawMappings: Record<string, string> = {};
  for (const mapping of updates) {
    if (mapping.variable) {
      rawMappings[mapping.variable] = mapping.sampleType;
    }
  }

  saveMCMappings(rawMappings);
  return getMCMappings();
}
