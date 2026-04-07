import { Request } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../utils/simulation/variable';
import { getPersonBirthDate, getPersonConfigs, getPersonRetirementDate } from '../person-config/person-config';
import { getAccountsAndTransfers } from '../../utils/io/accountsAndTransfers';
import { calculateAllActivityWithEngine } from '../../utils/calculate-v3/engine';
import { AcaManager } from '../../utils/calculate-v3/aca-manager';
import { MedicareManager } from '../../utils/calculate-v3/medicare-manager';
import { load } from '../../utils/io/io';
import { loadAllHealthcareConfigs } from '../../utils/io/virtualHealthcarePlans';

dayjs.extend(utc);

export interface HealthcareProjectionYear {
  year: number;
  persons: Record<string, { age: number }>;
  phase: 'cobra' | 'aca' | 'medicare' | 'split'; // split = one on ACA, one on Medicare
  estimatedMAGI: number;

  // COBRA (if applicable)
  cobraMonthlyPremium: number | null;

  // ACA (if applicable)
  acaGrossMonthlyPremium: number | null;
  acaMonthlySubsidy: number | null;
  acaNetMonthlyPremium: number | null;

  // Medicare (per person, if applicable)
  medicarePartBPremium: number | null;  // monthly, per person
  medicarePartDPremium: number | null;  // monthly, per person
  medicareIrmaaPartBSurcharge: number | null; // monthly, per person
  medicareIrmaaPartDSurcharge: number | null; // monthly, per person
  medicareMedigapPremium: number | null; // monthly, per person
  medicareTotalMonthly: number | null;  // total monthly for all persons on Medicare

  // Combined
  totalAnnualCost: number;
}

export interface HealthcareProjectionResponse {
  projections: HealthcareProjectionYear[];
  retirementYear: number;
  persons: Record<string, { medicareYear: number }>;
  cobraEndYear: number;  // retirement year + 1.5 years
  projectionEndYear: number;
}

export async function getHealthcareProjections(request: Request): Promise<HealthcareProjectionResponse> {
  const simulation = (request.query.simulation as string) || 'Default';

  // Load person variables
  let retireDate: Date;

  const personConfigs = getPersonConfigs();
  const personBirthYears: Record<string, number> = {};

  try {
    for (const p of personConfigs) {
      personBirthYears[p.name] = getPersonBirthDate(p.name).getUTCFullYear();
    }
    const retireDates = personConfigs.map(p => getPersonRetirementDate(p.name));
    retireDate = new Date(Math.min(...retireDates.map(d => d.getTime())));
  } catch (e) {
    throw new Error('Missing required person birth date or retirement config');
  }

  const retirementYear = retireDate.getUTCFullYear();

  // Project until youngest person reaches 95
  const laterBirthYear = Math.max(...Object.values(personBirthYears));
  const projectionEndYear = laterBirthYear + 95;

  const personMedicareYears: Record<string, { medicareYear: number }> = {};
  for (const [name, birthYear] of Object.entries(personBirthYears)) {
    personMedicareYears[name] = { medicareYear: birthYear + 65 };
  }

  // COBRA ends 18 months after retirement
  const cobraEndDate = dayjs.utc(retireDate).add(18, 'month');
  const cobraEndYear = cobraEndDate.year();

  // Early exit if retirement is in the future — no projections to compute
  const currentYear = new Date().getUTCFullYear();
  if (retirementYear > currentYear) {
    return {
      projections: [],
      retirementYear,
      persons: personMedicareYears,
      cobraEndYear,
      projectionEndYear,
    };
  }

  // Run calculation engine to projection end date
  const endDate = new Date(Date.UTC(projectionEndYear, 11, 31));
  const startDate = new Date(Date.UTC(retirementYear, 0, 1)); // start from retirement year Jan 1

  const rawData = getAccountsAndTransfers(simulation);

  const { engine } = await calculateAllActivityWithEngine(
    rawData,
    startDate,
    endDate,
    simulation,
    false, // not MC
    1, 1,
    true,  // force recalculation — we need the extended date range
    false, // logging
  );

  const taxManager = engine.getTaxManager();
  const acaManager = engine.getAcaManager();
  const medicareManager = engine.getMedicareManager();

  // Load tax config for filing status
  let filingStatus: 'mfj' | 'single' = 'mfj';
  try {
    const taxConfig = load<{ filingStatus: string }>('taxConfig.json');
    filingStatus = (taxConfig.filingStatus === 'mfj' ? 'mfj' : 'single');
  } catch { /* default mfj */ }

  // Load healthcare config for COBRA base premium override
  let cobraBasePremium: number | undefined;
  try {
    const configs = loadAllHealthcareConfigs(simulation);
    // Find config that has monthlyPremium (employer plan)
    const employerConfig = configs.find(c => c.monthlyPremium && c.monthlyPremium > 0);
    cobraBasePremium = employerConfig?.monthlyPremium;
  } catch { /* no override */ }

  const projections: HealthcareProjectionYear[] = [];
  const householdSize = personConfigs.length;

  for (let year = retirementYear; year <= projectionEndYear; year++) {
    const persons: Record<string, { age: number }> = {};
    const personAges: { name: string; age: number }[] = [];
    for (const [name, birthYear] of Object.entries(personBirthYears)) {
      const age = year - birthYear;
      persons[name] = { age };
      personAges.push({ name, age });
    }

    // Get MAGI from prior year tax occurrences
    const priorYearOccurrences = taxManager.getAllOccurrencesForYear(year - 1);
    let estimatedMAGI = 0;
    for (const occ of priorYearOccurrences) {
      if (occ.incomeType !== 'penalty') {
        estimatedMAGI += occ.amount;
      }
    }

    // Determine phase
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const isCobraPeriod = acaManager.isCobraPeriod(retireDate, yearStart);
    const medicarePersons = personAges.filter(p => p.age >= 65);
    const nonMedicarePersons = personAges.filter(p => p.age < 65);
    const allMedicare = medicarePersons.length === personAges.length;

    let phase: HealthcareProjectionYear['phase'];
    if (isCobraPeriod) {
      phase = 'cobra';
    } else if (allMedicare) {
      phase = 'medicare';
    } else if (medicarePersons.length > 0) {
      phase = 'split';
    } else {
      phase = 'aca';
    }

    let cobraMonthlyPremium: number | null = null;
    let acaGrossMonthlyPremium: number | null = null;
    let acaMonthlySubsidy: number | null = null;
    let acaNetMonthlyPremium: number | null = null;
    let medicarePartBPremium: number | null = null;
    let medicarePartDPremium: number | null = null;
    let medicareIrmaaPartBSurcharge: number | null = null;
    let medicareIrmaaPartDSurcharge: number | null = null;
    let medicareMedigapPremium: number | null = null;
    let medicareTotalMonthly: number | null = null;
    let totalAnnualCost = 0;

    // COBRA
    if (phase === 'cobra') {
      cobraMonthlyPremium = acaManager.getCobraMonthlyPremium(year, cobraBasePremium);
      totalAnnualCost = cobraMonthlyPremium * 12;
    }

    // ACA (no one on Medicare yet)
    if (phase === 'aca') {
      if (personAges.length === 1) {
        acaGrossMonthlyPremium = acaManager.getAcaPremiumForPerson(personAges[0].age, year);
      } else {
        // ACA couple premium supports max 2 persons — household model is 1-2 persons
        acaGrossMonthlyPremium = acaManager.getAcaCoupleGrossPremium(personAges[0].age, personAges[1].age, year);
      }
      acaMonthlySubsidy = acaManager.calculateMonthlySubsidy(estimatedMAGI, householdSize, year, acaGrossMonthlyPremium);
      acaNetMonthlyPremium = Math.max(0, acaGrossMonthlyPremium - acaMonthlySubsidy);
      totalAnnualCost = acaNetMonthlyPremium * 12;
    }

    // Medicare (all persons on Medicare)
    if (phase === 'medicare') {
      medicarePartBPremium = medicareManager.getPartBPremium(year);
      medicarePartDPremium = medicareManager.getPartDBasePremium(year);
      const irmaa = medicareManager.getIRMAASurcharge(estimatedMAGI, filingStatus, year);
      medicareIrmaaPartBSurcharge = irmaa.partBSurcharge;
      medicareIrmaaPartDSurcharge = irmaa.partDSurcharge;
      let totalMedicareCost = 0;
      for (const p of medicarePersons) {
        totalMedicareCost += medicareManager.getMonthlyMedicareCost(p.age, estimatedMAGI, filingStatus, year);
      }
      medicareTotalMonthly = totalMedicareCost;
      totalAnnualCost = medicareTotalMonthly * 12;
    }

    // Split (some on Medicare, some on ACA)
    if (phase === 'split') {
      // Medicare persons
      let totalMedicareCost = 0;
      for (const p of medicarePersons) {
        totalMedicareCost += medicareManager.getMonthlyMedicareCost(p.age, estimatedMAGI, filingStatus, year);
      }
      medicareTotalMonthly = totalMedicareCost;

      medicarePartBPremium = medicareManager.getPartBPremium(year);
      medicarePartDPremium = medicareManager.getPartDBasePremium(year);
      const irmaa = medicareManager.getIRMAASurcharge(estimatedMAGI, filingStatus, year);
      medicareIrmaaPartBSurcharge = irmaa.partBSurcharge;
      medicareIrmaaPartDSurcharge = irmaa.partDSurcharge;

      // ACA for non-Medicare persons
      if (nonMedicarePersons.length === 1) {
        acaGrossMonthlyPremium = acaManager.getAcaPremiumForPerson(nonMedicarePersons[0].age, year);
      } else {
        // ACA couple premium supports max 2 persons — household model is 1-2 persons
        acaGrossMonthlyPremium = acaManager.getAcaCoupleGrossPremium(
          nonMedicarePersons[0].age, nonMedicarePersons[1].age, year
        );
      }
      acaMonthlySubsidy = acaManager.calculateMonthlySubsidy(estimatedMAGI, householdSize, year, acaGrossMonthlyPremium);
      acaNetMonthlyPremium = Math.max(0, acaGrossMonthlyPremium - acaMonthlySubsidy);

      totalAnnualCost = (totalMedicareCost + acaNetMonthlyPremium) * 12;
    }

    projections.push({
      year,
      persons,
      phase,
      estimatedMAGI,
      cobraMonthlyPremium,
      acaGrossMonthlyPremium,
      acaMonthlySubsidy,
      acaNetMonthlyPremium,
      medicarePartBPremium,
      medicarePartDPremium,
      medicareIrmaaPartBSurcharge,
      medicareIrmaaPartDSurcharge,
      medicareMedigapPremium: null, // getMedigapMonthlyPremium is private, included in getMonthlyMedicareCost
      medicareTotalMonthly,
      totalAnnualCost,
    });
  }

  return {
    projections,
    retirementYear,
    persons: personMedicareYears,
    cobraEndYear,
    projectionEndYear,
  };
}
