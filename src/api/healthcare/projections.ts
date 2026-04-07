import { Request } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../utils/simulation/variable';
import { getPersonBirthDate } from '../person-config/person-config';
import { getAccountsAndTransfers } from '../../utils/io/accountsAndTransfers';
import { calculateAllActivityWithEngine } from '../../utils/calculate-v3/engine';
import { AcaManager } from '../../utils/calculate-v3/aca-manager';
import { MedicareManager } from '../../utils/calculate-v3/medicare-manager';
import { load } from '../../utils/io/io';
import { loadAllHealthcareConfigs } from '../../utils/io/virtualHealthcarePlans';

dayjs.extend(utc);

export interface HealthcareProjectionYear {
  year: number;
  jakeAge: number;
  kendallAge: number;
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
  jakeMedicareYear: number;  // year Jake turns 65
  kendallMedicareYear: number;  // year Kendall turns 65
  cobraEndYear: number;  // retirement year + 1.5 years
  projectionEndYear: number;
}

export async function getHealthcareProjections(request: Request): Promise<HealthcareProjectionResponse> {
  const simulation = (request.query.simulation as string) || 'Default';

  // Load person variables
  let jakeBirthDate: Date;
  let kendallBirthDate: Date;
  let retireDate: Date;

  try {
    jakeBirthDate = getPersonBirthDate('Jake');
    kendallBirthDate = getPersonBirthDate('Kendall');
    retireDate = loadVariable('RETIRE_DATE', simulation) as Date;
  } catch (e) {
    throw new Error('Missing required variables: Jake/Kendall birth date or RETIRE_DATE');
  }

  const jakeBirthYear = jakeBirthDate.getUTCFullYear();
  const kendallBirthYear = kendallBirthDate.getUTCFullYear();
  const retirementYear = retireDate.getUTCFullYear();

  // Project until both are 95 (use the younger person)
  const laterBirthYear = Math.max(jakeBirthYear, kendallBirthYear);
  const projectionEndYear = laterBirthYear + 95;

  const jakeMedicareYear = jakeBirthYear + 65;
  const kendallMedicareYear = kendallBirthYear + 65;

  // COBRA ends 18 months after retirement
  const cobraEndDate = dayjs.utc(retireDate).add(18, 'month');
  const cobraEndYear = cobraEndDate.year();

  // Early exit if retirement is in the future — no projections to compute
  const currentYear = new Date().getUTCFullYear();
  if (retirementYear > currentYear) {
    return {
      projections: [],
      retirementYear,
      jakeMedicareYear,
      kendallMedicareYear,
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
  const householdSize = 2; // Couple

  for (let year = retirementYear; year <= projectionEndYear; year++) {
    const jakeAge = year - jakeBirthYear;
    const kendallAge = year - kendallBirthYear;

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
    const jakeMedicare = jakeAge >= 65;
    const kendallMedicare = kendallAge >= 65;
    const bothMedicare = jakeMedicare && kendallMedicare;

    let phase: HealthcareProjectionYear['phase'];
    if (isCobraPeriod) {
      phase = 'cobra';
    } else if (bothMedicare) {
      phase = 'medicare';
    } else if (jakeMedicare || kendallMedicare) {
      phase = 'split'; // one on Medicare, one on ACA
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

    // ACA (neither on Medicare yet)
    if (phase === 'aca') {
      acaGrossMonthlyPremium = acaManager.getAcaCoupleGrossPremium(jakeAge, kendallAge, year);
      acaMonthlySubsidy = acaManager.calculateMonthlySubsidy(estimatedMAGI, householdSize, year, acaGrossMonthlyPremium);
      acaNetMonthlyPremium = Math.max(0, acaGrossMonthlyPremium - acaMonthlySubsidy);
      totalAnnualCost = acaNetMonthlyPremium * 12;
    }

    // Medicare (both on Medicare)
    if (phase === 'medicare') {
      medicarePartBPremium = medicareManager.getPartBPremium(year);
      medicarePartDPremium = medicareManager.getPartDBasePremium(year);
      const irmaa = medicareManager.getIRMAASurcharge(estimatedMAGI, filingStatus, year);
      medicareIrmaaPartBSurcharge = irmaa.partBSurcharge;
      medicareIrmaaPartDSurcharge = irmaa.partDSurcharge;
      // getMedigapMonthlyPremium is private — use getMonthlyMedicareCost and subtract parts
      // Actually, let's compute total per person then multiply by 2
      const jakeTotal = medicareManager.getMonthlyMedicareCost(jakeAge, estimatedMAGI, filingStatus, year);
      const kendallTotal = medicareManager.getMonthlyMedicareCost(kendallAge, estimatedMAGI, filingStatus, year);
      medicareTotalMonthly = jakeTotal + kendallTotal;
      totalAnnualCost = medicareTotalMonthly * 12;
    }

    // Split (one on Medicare, one on ACA)
    if (phase === 'split') {
      const medicareAge = jakeMedicare ? jakeAge : kendallAge;
      const acaAge = jakeMedicare ? kendallAge : jakeAge;

      // Medicare person
      const medicareCost = medicareManager.getMonthlyMedicareCost(medicareAge, estimatedMAGI, filingStatus, year);
      medicareTotalMonthly = medicareCost;

      medicarePartBPremium = medicareManager.getPartBPremium(year);
      medicarePartDPremium = medicareManager.getPartDBasePremium(year);
      const irmaa = medicareManager.getIRMAASurcharge(estimatedMAGI, filingStatus, year);
      medicareIrmaaPartBSurcharge = irmaa.partBSurcharge;
      medicareIrmaaPartDSurcharge = irmaa.partDSurcharge;

      // ACA person (single, skip the 65+ person)
      acaGrossMonthlyPremium = acaManager.getAcaPremiumForPerson(acaAge, year);
      acaMonthlySubsidy = acaManager.calculateMonthlySubsidy(estimatedMAGI, 1, year, acaGrossMonthlyPremium);
      acaNetMonthlyPremium = Math.max(0, acaGrossMonthlyPremium - acaMonthlySubsidy);

      totalAnnualCost = (medicareCost + acaNetMonthlyPremium) * 12;
    }

    projections.push({
      year,
      jakeAge,
      kendallAge,
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
    jakeMedicareYear,
    kendallMedicareYear,
    cobraEndYear,
    projectionEndYear,
  };
}
