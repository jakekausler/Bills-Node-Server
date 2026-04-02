import { load, save } from './io';

const TAX_SCENARIO_FILE = 'taxScenario.json';

export interface TaxScenario {
  name: 'currentLaw' | 'currentPolicy' | 'rising' | 'custom';
  bracketEvolution: 'tcjaExpires' | 'tcjaPermanent' | 'rateCreep' | 'custom';
  customRates?: { year: number; bracketMultiplier: number }[] | null;
}

const DEFAULT_TAX_SCENARIO: TaxScenario = {
  name: 'currentPolicy',
  bracketEvolution: 'tcjaPermanent',
  customRates: null,
};

export function loadTaxScenario(): TaxScenario {
  try {
    return load<TaxScenario>(TAX_SCENARIO_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_TAX_SCENARIO;
    }
    throw error;
  }
}

export function saveTaxScenario(scenario: TaxScenario): void {
  save(scenario, TAX_SCENARIO_FILE);
}
