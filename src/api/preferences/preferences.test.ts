import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/io/io', () => ({
  load: vi.fn(),
  save: vi.fn(),
}));

import { load, save } from '../../utils/io/io';
import { getPreferences, getPreferencesHandler, updatePreferences } from './preferences';
import type { UserPreferences } from './types';
import { Request } from 'express';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mock io: load/save are synchronous, use mockReturnValue
// - Async handlers: use async/await and rejects.toThrow for error cases
// - Structure: describe/it with beforeEach vi.clearAllMocks()

const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);

const seedPreferences: UserPreferences = {
  hiddenPages: ['accounts', 'bills'],
  pinnedPages: ['dashboard'],
  tabPreferences: {
    accounts: {
      hiddenTabs: ['history'],
      tabOrder: ['overview', 'history'],
    },
  },
};

const emptyPreferences: UserPreferences = {
  hiddenPages: [],
  pinnedPages: [],
  tabPreferences: {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPreferencesHandler', () => {
  it('returns default empty preferences when file does not exist', async () => {
    mockLoad.mockImplementation(() => {
      throw new Error('File not found');
    });

    const result = await getPreferencesHandler({} as Request);

    expect(result).toEqual(emptyPreferences);
  });

  it('returns saved preferences when file exists', async () => {
    mockLoad.mockReturnValue(seedPreferences as any);

    const result = await getPreferencesHandler({} as Request);

    expect(result).toEqual(seedPreferences);
  });
});

describe('updatePreferences', () => {
  it('saves valid preferences and returns them', async () => {
    const req = { body: seedPreferences } as Request;

    const result = await updatePreferences(req);

    expect(result).toEqual(seedPreferences);
    expect(mockSave).toHaveBeenCalledOnce();
    expect(mockSave).toHaveBeenCalledWith(seedPreferences, 'userPreferences.json');
  });

  it('rejects hiddenPages containing "settings"', async () => {
    const req = {
      body: {
        ...seedPreferences,
        hiddenPages: ['accounts', 'settings'],
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('hiddenPages cannot contain "settings"');
  });

  it('rejects non-array hiddenPages', async () => {
    const req = {
      body: {
        ...seedPreferences,
        hiddenPages: 'not-an-array',
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('hiddenPages must be an array of strings');
  });

  it('rejects non-array pinnedPages', async () => {
    const req = {
      body: {
        ...seedPreferences,
        pinnedPages: { page: 'dashboard' },
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('pinnedPages must be an array of strings');
  });

  it('rejects invalid tabPreferences structure (array instead of object)', async () => {
    const req = {
      body: {
        ...seedPreferences,
        tabPreferences: ['not', 'an', 'object'],
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('tabPreferences must be an object');
  });

  it('rejects invalid tabPreferences structure (non-object value)', async () => {
    const req = {
      body: {
        ...seedPreferences,
        tabPreferences: null,
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('tabPreferences must be an object');
  });

  it('rejects non-string items in hiddenPages', async () => {
    const req = {
      body: {
        ...seedPreferences,
        hiddenPages: ['accounts', 42, true],
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('hiddenPages must be an array of strings');
  });

  it('rejects non-string items in pinnedPages', async () => {
    const req = {
      body: {
        ...seedPreferences,
        pinnedPages: [null, 'dashboard'],
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow('pinnedPages must be an array of strings');
  });

  it('rejects invalid hiddenTabs in a tabPreference entry', async () => {
    const req = {
      body: {
        ...seedPreferences,
        tabPreferences: {
          accounts: {
            hiddenTabs: 'not-an-array',
            tabOrder: ['overview'],
          },
        },
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow(
      'tabPreferences["accounts"].hiddenTabs must be an array of strings',
    );
  });

  it('rejects invalid tabOrder in a tabPreference entry', async () => {
    const req = {
      body: {
        ...seedPreferences,
        tabPreferences: {
          accounts: {
            hiddenTabs: [],
            tabOrder: [1, 2, 3],
          },
        },
      },
    } as Request;

    await expect(updatePreferences(req)).rejects.toThrow(
      'tabPreferences["accounts"].tabOrder must be an array of strings',
    );
  });

  it('accepts empty hiddenPages, pinnedPages, and tabPreferences', async () => {
    const req = { body: emptyPreferences } as Request;

    const result = await updatePreferences(req);

    expect(result).toEqual(emptyPreferences);
    expect(mockSave).toHaveBeenCalledOnce();
  });
});

describe('getPreferences', () => {
  it('returns current preferences from file', () => {
    mockLoad.mockReturnValue(seedPreferences as any);

    const result = getPreferences();

    expect(result).toEqual(seedPreferences);
  });

  it('returns default empty preferences when file does not exist', () => {
    mockLoad.mockImplementation(() => {
      throw new Error('File not found');
    });

    const result = getPreferences();

    expect(result).toEqual(emptyPreferences);
  });
});
