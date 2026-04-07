import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/io/io', () => ({
  load: vi.fn(),
  save: vi.fn(),
}));

import { load, save } from '../../utils/io/io';
import {
  getPersonConfigs,
  getPersonByName,
  getPersonBirthDate,
  getPersonRetirementDate,
  getPersonSSStartDate,
  getPersonNames,
  getPersonGender,
  computeRetirementDate,
  computeSSStartDate,
  getPersonConfigsHandler,
  createPersonConfig,
  updatePersonConfigs,
  deletePersonConfig,
} from './person-config';
import type { PersonConfig } from './types';
import { Request } from 'express';

const mockLoad = vi.mocked(load);
const mockSave = vi.mocked(save);

const seedPersons: PersonConfig[] = [
  {
    name: 'Jake',
    gender: 'male',
    birthDate: '1993-07-15',
    retirementAge: { years: 62, months: 0 },
    ssStartAge: 70,
  },
  {
    name: 'Kendall',
    gender: 'female',
    birthDate: '1994-11-16',
    retirementAge: { years: 60, months: 8 },
    ssStartAge: 70,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockReturnValue(seedPersons as any);
});

describe('computeRetirementDate', () => {
  it('computes Jake retirement date', () => {
    const date = computeRetirementDate(seedPersons[0]);
    expect(date.toISOString().slice(0, 10)).toBe('2055-07-15');
  });

  it('computes Kendall retirement date', () => {
    const date = computeRetirementDate(seedPersons[1]);
    // 1994-11-16 + 60y 8m = 2055-07-16 (1-day rounding from original 2055-07-15)
    expect(date.toISOString().slice(0, 10)).toBe('2055-07-16');
  });
});

describe('computeSSStartDate', () => {
  it('computes Jake SS start date', () => {
    const date = computeSSStartDate(seedPersons[0]);
    expect(date.toISOString().slice(0, 10)).toBe('2063-07-15');
  });

  it('computes Kendall SS start date', () => {
    const date = computeSSStartDate(seedPersons[1]);
    expect(date.toISOString().slice(0, 10)).toBe('2064-11-16');
  });
});

describe('helper functions', () => {
  it('getPersonConfigs returns all persons', () => {
    expect(getPersonConfigs()).toHaveLength(2);
  });

  it('getPersonByName returns matching person', () => {
    expect(getPersonByName('Jake')).toEqual(seedPersons[0]);
  });

  it('getPersonByName returns undefined for unknown', () => {
    expect(getPersonByName('Unknown')).toBeUndefined();
  });

  it('getPersonBirthDate returns Date', () => {
    const date = getPersonBirthDate('Jake');
    expect(date.toISOString().slice(0, 10)).toBe('1993-07-15');
  });

  it('getPersonBirthDate throws for unknown person', () => {
    expect(() => getPersonBirthDate('Unknown')).toThrow('Unknown person: Unknown');
  });

  it('getPersonRetirementDate delegates correctly', () => {
    const date = getPersonRetirementDate('Jake');
    expect(date.toISOString().slice(0, 10)).toBe('2055-07-15');
  });

  it('getPersonSSStartDate delegates correctly', () => {
    const date = getPersonSSStartDate('Jake');
    expect(date.toISOString().slice(0, 10)).toBe('2063-07-15');
  });

  it('getPersonNames returns name array', () => {
    expect(getPersonNames()).toEqual(['Jake', 'Kendall']);
  });

  it('getPersonGender returns gender', () => {
    expect(getPersonGender('Jake')).toBe('male');
    expect(getPersonGender('Kendall')).toBe('female');
  });

  it('getPersonGender throws for unknown', () => {
    expect(() => getPersonGender('Unknown')).toThrow('Unknown person: Unknown');
  });
});

describe('CRUD handlers', () => {
  it('getPersonConfigsHandler returns all persons', async () => {
    const result = await getPersonConfigsHandler({} as Request);
    expect(result).toHaveLength(2);
  });

  it('createPersonConfig adds a new person', async () => {
    const req = {
      body: {
        name: 'NewPerson',
        gender: 'male',
        birthDate: '2000-01-01',
        retirementAge: { years: 65, months: 0 },
        ssStartAge: 67,
      },
    } as Request;
    const result = await createPersonConfig(req);
    expect(result.name).toBe('NewPerson');
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('createPersonConfig rejects duplicate name', async () => {
    const req = {
      body: {
        name: 'Jake',
        gender: 'male',
        birthDate: '2000-01-01',
        retirementAge: { years: 65, months: 0 },
        ssStartAge: 67,
      },
    } as Request;
    await expect(createPersonConfig(req)).rejects.toThrow('already exists');
  });

  it('createPersonConfig rejects invalid gender', async () => {
    const req = {
      body: {
        name: 'Test',
        gender: 'other',
        birthDate: '2000-01-01',
        retirementAge: { years: 65, months: 0 },
        ssStartAge: 67,
      },
    } as Request;
    await expect(createPersonConfig(req)).rejects.toThrow('gender must be');
  });

  it('createPersonConfig rejects missing birthDate', async () => {
    const req = {
      body: {
        name: 'Test',
        gender: 'male',
        retirementAge: { years: 65, months: 0 },
        ssStartAge: 67,
      },
    } as Request;
    await expect(createPersonConfig(req)).rejects.toThrow('birthDate');
  });

  it('createPersonConfig rejects invalid retirementAge months', async () => {
    const req = {
      body: {
        name: 'Test',
        gender: 'male',
        birthDate: '2000-01-01',
        retirementAge: { years: 65, months: 13 },
        ssStartAge: 67,
      },
    } as Request;
    await expect(createPersonConfig(req)).rejects.toThrow('retirementAge.months');
  });

  it('updatePersonConfigs replaces all persons', async () => {
    const newData: PersonConfig[] = [seedPersons[0]];
    const req = { body: newData } as Request;
    const result = await updatePersonConfigs(req);
    expect(result).toHaveLength(1);
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('updatePersonConfigs rejects non-array', async () => {
    const req = { body: { name: 'Jake' } } as Request;
    await expect(updatePersonConfigs(req)).rejects.toThrow('Person configs must contain 1 or 2 persons');
  });

  it('updatePersonConfigs rejects empty array', async () => {
    const req = { body: [] } as Request;
    await expect(updatePersonConfigs(req)).rejects.toThrow('Person configs must contain 1 or 2 persons');
  });

  it('updatePersonConfigs rejects more than 2 persons', async () => {
    const req = {
      body: [
        seedPersons[0],
        seedPersons[1],
        {
          name: 'Third',
          gender: 'male',
          birthDate: '2000-01-01',
          retirementAge: { years: 65, months: 0 },
          ssStartAge: 67,
        },
      ],
    } as Request;
    await expect(updatePersonConfigs(req)).rejects.toThrow('Person configs must contain 1 or 2 persons');
  });

  it('deletePersonConfig removes person', async () => {
    const req = { params: { name: 'Jake' } } as unknown as Request;
    const result = await deletePersonConfig(req);
    expect(result).toEqual({ name: 'Jake' });
    expect(mockSave).toHaveBeenCalledOnce();
  });

  it('deletePersonConfig rejects unknown person', async () => {
    mockLoad.mockReturnValue(seedPersons as any);
    const req = { params: { name: 'Unknown' } } as unknown as Request;
    await expect(deletePersonConfig(req)).rejects.toThrow('not found');
  });

  it('deletePersonConfig blocks deleting last person', async () => {
    // Create a fresh mock for this specific test
    vi.clearAllMocks();
    mockLoad.mockReturnValue([
      {
        name: 'Jake',
        gender: 'male',
        birthDate: '1993-07-15',
        retirementAge: { years: 62, months: 0 },
        ssStartAge: 70,
      },
    ] as any);
    const req = { params: { name: 'Jake' } } as unknown as Request;
    await expect(deletePersonConfig(req)).rejects.toThrow('Cannot delete the last person');
  });
});
