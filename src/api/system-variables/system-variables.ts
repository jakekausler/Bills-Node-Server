import { getPersonNames, getPersonRetirementDate, getPersonSSStartDate } from '../person-config/person-config';
import type { SystemVariable } from './types';

const RETIRE_DATE_SUFFIX = '_RETIRE_DATE';
const SS_START_DATE_SUFFIX = '_SS_START_DATE';

export function getSystemVariables(): SystemVariable[] {
  const names = getPersonNames();
  const result: SystemVariable[] = [];
  for (const name of names) {
    const upper = name.toUpperCase();
    result.push({ name: `${upper}${RETIRE_DATE_SUFFIX}`, value: getPersonRetirementDate(name) });
    result.push({ name: `${upper}${SS_START_DATE_SUFFIX}`, value: getPersonSSStartDate(name) });
  }
  return result;
}

export function resolveSystemVariable(name: string): Date | null {
  const personNames = getPersonNames();
  for (const pName of personNames) {
    const upper = pName.toUpperCase();
    if (name === `${upper}${RETIRE_DATE_SUFFIX}`) return getPersonRetirementDate(pName);
    if (name === `${upper}${SS_START_DATE_SUFFIX}`) return getPersonSSStartDate(pName);
  }
  return null;
}

export function isSystemVariable(name: string): boolean {
  const personNames = getPersonNames().map(n => n.toUpperCase());
  for (const pName of personNames) {
    if (name === `${pName}${RETIRE_DATE_SUFFIX}` || name === `${pName}${SS_START_DATE_SUFFIX}`) {
      return true;
    }
  }
  return false;
}
