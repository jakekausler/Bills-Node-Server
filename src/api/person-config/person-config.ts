import { Request } from 'express';
import { load, save } from '../../utils/io/io';
import type { PersonConfig } from './types';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { ApiError } from '../errors';

dayjs.extend(utc);

const CONFIG_FILE = 'personConfig.json';

// ─── Private Helpers ───

function loadPersons(): PersonConfig[] {
  try {
    return load<PersonConfig[]>(CONFIG_FILE);
  } catch {
    return [];
  }
}

function savePersons(persons: PersonConfig[]): void {
  save(persons, CONFIG_FILE);
}

function validatePersonConfig(body: Record<string, unknown>): void {
  if (!body.name || typeof body.name !== 'string') {
    throw new ApiError('name is required and must be a string', 400);
  }
  if (body.gender !== 'male' && body.gender !== 'female') {
    throw new ApiError('gender must be "male" or "female"', 400);
  }
  if (!body.birthDate || typeof body.birthDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.birthDate)) {
    throw new ApiError('birthDate is required in YYYY-MM-DD format', 400);
  }
  if (!dayjs.utc(body.birthDate).isValid()) throw new ApiError('Invalid birthDate: not a valid date', 400);
  if (!body.retirementAge || typeof body.retirementAge !== 'object') {
    throw new ApiError('retirementAge is required', 400);
  }
  const ra = body.retirementAge as Record<string, unknown>;
  if (typeof ra.years !== 'number' || ra.years < 0 || !Number.isInteger(ra.years)) {
    throw new ApiError('retirementAge.years must be a non-negative number', 400);
  }
  if (typeof ra.months !== 'number' || ra.months < 0 || ra.months > 11 || !Number.isInteger(ra.months)) {
    throw new ApiError('retirementAge.months must be 0-11', 400);
  }
  if (typeof body.ssStartAge !== 'number' || body.ssStartAge < 0 || !Number.isInteger(body.ssStartAge)) {
    throw new ApiError('ssStartAge must be a non-negative number', 400);
  }
}

// ─── Derived Date Helpers ───

export function computeRetirementDate(person: PersonConfig): Date {
  return dayjs.utc(person.birthDate)
    .add(person.retirementAge.years, 'year')
    .add(person.retirementAge.months, 'month')
    .add(person.retirementAge.days, 'day')
    .toDate();
}

export function computeSSStartDate(person: PersonConfig): Date {
  return dayjs.utc(person.birthDate)
    .add(person.ssStartAge, 'year')
    .toDate();
}

// ─── Public API Helpers ───

export function getPersonConfigs(): PersonConfig[] {
  return loadPersons();
}

export function getPersonByName(name: string): PersonConfig | undefined {
  return loadPersons().find(p => p.name === name);
}

export function getPersonBirthDate(name: string): Date {
  const person = getPersonByName(name);
  if (!person) throw new Error(`Unknown person: ${name}`);
  return dayjs.utc(person.birthDate).toDate();
}

export function getPersonRetirementDate(name: string): Date {
  const person = getPersonByName(name);
  if (!person) throw new Error(`Unknown person: ${name}`);
  return computeRetirementDate(person);
}

export function getPersonSSStartDate(name: string): Date {
  const person = getPersonByName(name);
  if (!person) throw new Error(`Unknown person: ${name}`);
  return computeSSStartDate(person);
}

export function getPersonNames(): string[] {
  return loadPersons().map(p => p.name);
}

export function getPersonGender(name: string): 'male' | 'female' {
  const person = getPersonByName(name);
  if (!person) {
    const names = getPersonNames();
    throw new Error(`Unknown person: ${name}. Known: ${names.join(', ')}`);
  }
  return person.gender;
}

// ─── CRUD Handlers ───

export async function getPersonConfigsHandler(_req: Request): Promise<PersonConfig[]> {
  return loadPersons();
}

export async function createPersonConfig(req: Request): Promise<PersonConfig> {
  validatePersonConfig(req.body);
  const persons = loadPersons();
  const name = req.body.name as string;
  if (persons.find(p => p.name === name)) {
    throw new ApiError(`Person "${name}" already exists`, 400);
  }
  const newPerson: PersonConfig = {
    name: req.body.name,
    gender: req.body.gender,
    birthDate: req.body.birthDate,
    retirementAge: req.body.retirementAge,
    ssStartAge: req.body.ssStartAge,
  };
  persons.push(newPerson);
  savePersons(persons);
  return newPerson;
}

export async function updatePersonConfigs(req: Request): Promise<PersonConfig[]> {
  const updates = req.body as PersonConfig[];
  // Domain constraint: household model supports exactly 1-2 persons
  if (!Array.isArray(updates) || updates.length === 0 || updates.length > 2) {
    throw new ApiError('Person configs must contain 1 or 2 persons', 400);
  }
  const names = updates.map((u: any) => u.name);
  if (new Set(names).size !== names.length) {
    throw new ApiError('Duplicate person names are not allowed', 400);
  }
  for (const p of updates) {
    validatePersonConfig(p as unknown as Record<string, unknown>);
  }
  savePersons(updates);
  return updates;
}

export async function deletePersonConfig(req: Request): Promise<{ name: string }> {
  const name = req.params.name;
  if (!name) throw new ApiError('name parameter is required', 400);
  const persons = loadPersons();
  const index = persons.findIndex(p => p.name === name);
  if (index === -1) throw new ApiError(`Person "${name}" not found`, 404);
  if (persons.length <= 1) throw new ApiError('Cannot delete the last person', 400);
  persons.splice(index, 1);
  savePersons(persons);
  return { name };
}
