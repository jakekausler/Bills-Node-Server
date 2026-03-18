import { load } from './io';

interface LtcPersonConfig {
  personName: string;
  gender: 'male' | 'female';
  birthDateVariable: string;
  hasInsurance: boolean;
  [key: string]: unknown;
}

interface PersonConfig {
  personName: string;
  gender: 'male' | 'female';
}

export function getPersonConfigs(): PersonConfig[] {
  const ltcConfigs = load<LtcPersonConfig[]>('ltcConfig.json');
  if (!ltcConfigs || ltcConfigs.length === 0) {
    throw new Error('ltcConfig.json is empty or missing. Person configuration requires at least one LTC config entry with personName and gender fields.');
  }
  return ltcConfigs.map(({ personName, gender }) => ({ personName, gender }));
}

export function getPersonNames(): string[] {
  const configs = getPersonConfigs();
  return configs.map(c => c.personName);
}

export function getPersonGender(personName: string): 'male' | 'female' {
  const configs = getPersonConfigs();
  const person = configs.find(c => c.personName === personName);
  if (!person) {
    throw new Error(`Unknown person: ${personName}. Known: ${configs.map(c => c.personName).join(', ')}`);
  }
  return person.gender;
}
