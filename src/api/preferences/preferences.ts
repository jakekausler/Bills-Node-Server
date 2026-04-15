import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import type { UserPreferences, TabPreference } from './types';
import { ApiError } from '../errors';

const PREFS_FILE = 'userPreferences.json';

const DEFAULT_PREFERENCES: UserPreferences = {
  hiddenPages: [],
  pinnedPages: [],
  tabPreferences: {},
};

// ─── Private Helpers ───

function loadPreferences(): UserPreferences {
  try {
    return load<UserPreferences>(PREFS_FILE);
  } catch {
    return structuredClone(DEFAULT_PREFERENCES);
  }
}

function savePreferences(prefs: UserPreferences): void {
  save(prefs, PREFS_FILE);
}

function validateStringArray(value: unknown, fieldName: string): asserts value is string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new ApiError(`${fieldName} must be an array of strings`, 400);
  }
}

function validateTabPreference(value: unknown, key: string): asserts value is TabPreference {
  if (!value || typeof value !== 'object') {
    throw new ApiError(`tabPreferences["${key}"] must be an object`, 400);
  }
  const obj = value as Record<string, unknown>;
  validateStringArray(obj.hiddenTabs, `tabPreferences["${key}"].hiddenTabs`);
  validateStringArray(obj.tabOrder, `tabPreferences["${key}"].tabOrder`);
}

function validatePreferences(body: Record<string, unknown>): void {
  validateStringArray(body.hiddenPages, 'hiddenPages');
  if ((body.hiddenPages as string[]).includes('settings')) {
    throw new ApiError('hiddenPages cannot contain "settings"', 400);
  }
  validateStringArray(body.pinnedPages, 'pinnedPages');
  if (!body.tabPreferences || typeof body.tabPreferences !== 'object' || Array.isArray(body.tabPreferences)) {
    throw new ApiError('tabPreferences must be an object', 400);
  }
  const tabPrefs = body.tabPreferences as Record<string, unknown>;
  for (const [key, value] of Object.entries(tabPrefs)) {
    validateTabPreference(value, key);
  }
}

// ─── Public API Helpers ───

export function getPreferences(): UserPreferences {
  return loadPreferences();
}

// ─── CRUD Handlers ───

export async function getPreferencesHandler(_req: Request): Promise<UserPreferences> {
  return loadPreferences();
}

export async function updatePreferences(req: Request): Promise<UserPreferences> {
  validatePreferences(req.body as Record<string, unknown>);
  const prefs: UserPreferences = {
    hiddenPages: req.body.hiddenPages,
    pinnedPages: req.body.pinnedPages,
    tabPreferences: req.body.tabPreferences,
  };
  savePreferences(prefs);
  return prefs;
}
