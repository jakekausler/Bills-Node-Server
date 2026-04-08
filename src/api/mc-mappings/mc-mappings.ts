import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import { ApiError } from '../errors';
import type { MCMapping } from './types';
import { MonteCarloSampleType } from '../../utils/calculate-v3/types';
import { getRates } from '../rates-config/rates-config';

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
  const rates = getRates();

  return rates.map(rate => ({
    variable: rate.name,
    sampleType: rawMappings[rate.name] ?? null,
    description: rate.description,
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

  const validSampleTypes = Object.values(MonteCarloSampleType) as string[];

  // Validate each mapping
  for (const mapping of updates) {
    if (!mapping.variable || typeof mapping.variable !== 'string') {
      throw new ApiError('Each mapping must have a variable string', 400);
    }
    // Validate sampleType is a known enum value or null
    if (mapping.sampleType !== null && mapping.sampleType !== undefined) {
      if (typeof mapping.sampleType !== 'string') {
        throw new ApiError(`sampleType for "${mapping.variable}" must be a string or null`, 400);
      }
      if (!validSampleTypes.includes(mapping.sampleType)) {
        throw new ApiError(`Unknown sample type: "${mapping.sampleType}"`, 400);
      }
    }
  }

  // Build raw mappings (variable→sampleType format for monteCarloMappings.json)
  // Only save entries where sampleType is not null
  const rawMappings: Record<string, string> = {};
  for (const mapping of updates) {
    if (mapping.sampleType) {
      rawMappings[mapping.variable] = mapping.sampleType;
    }
  }

  saveMCMappings(rawMappings);
  return getMCMappings();
}
