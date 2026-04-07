import {
  getPersonConfigs as getConfigs,
  getPersonNames as getNames,
  getPersonGender as getGender,
} from '../../api/person-config/person-config';

// Legacy interface kept for backward compatibility with existing callers
export interface PersonConfig {
  personName: string;
  gender: string;
}

// LtcPersonConfig interface kept for backward compatibility with ltcConfig.json users
export interface LtcPersonConfig {
  personName: string;
  gender: 'male' | 'female';
  birthDateVariable: string;
  hasInsurance: boolean;
  [key: string]: unknown;
}

export function getPersonConfigs(): PersonConfig[] {
  return getConfigs().map(p => ({ personName: p.name, gender: p.gender }));
}

export function getPersonNames(): string[] {
  return getNames();
}

export function getPersonGender(personName: string): 'male' | 'female' {
  return getGender(personName);
}
