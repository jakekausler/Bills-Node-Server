import { Request } from 'express';
import { getAccountsAndTransfers } from '../../utils/io/accountsAndTransfers';
import { calculateAllActivityWithEngine } from '../../utils/calculate-v3/engine';
import { loadTaxProfile } from '../../utils/io/taxProfile';
import { getBracketDataForYear, calculateProgressiveTaxDetailed } from '../../utils/calculate-v3/bracket-calculator';
import type { TaxReconciliation } from '../../utils/calculate-v3/types';
import type { TaxProfile } from '../../utils/calculate-v3/tax-profile-types';
import { getPersonConfigs, getPersonBirthDate, getPersonRetirementDate } from '../person-config/person-config';
import { load } from '../../utils/io/io';
import { loadAllHealthcareConfigs } from '../../utils/io/virtualHealthcarePlans';
import type { TaxManager } from '../../utils/calculate-v3/tax-manager';
import type { AcaManager } from '../../utils/calculate-v3/aca-manager';
import type { MedicareManager } from '../../utils/calculate-v3/medicare-manager';
import type { DeductionTracker } from '../../utils/calculate-v3/deduction-tracker';

export interface HealthcareTaxImpact {
  phase: 'cobra' | 'aca' | 'medicare' | 'split' | null;
  estimatedMAGI: number;

  // COBRA
  cobraMonthlyPremium: number | null;

  // ACA
  acaGrossMonthlyPremium: number | null;
  acaMonthlySubsidy: number | null;
  acaNetMonthlyPremium: number | null;

  // Medicare / IRMAA (per person)
  medicarePartBPremium: number | null;
  medicarePartDPremium: number | null;
  medicareIrmaaPartBSurcharge: number | null;
  medicareIrmaaPartDSurcharge: number | null;
  medicareTotalMonthly: number | null;

  // HSA
  hsaContribution: number;

  // Combined
  totalAnnualCost: number;
}

export interface TaxDetailResponse {
  reconciliation: TaxReconciliation;
  incomeByAccount: Array<{
    accountId: string;
    accountName: string;
    incomeByType: Record<string, number>;
    total: number;
  }>;
  withholdingBySource: Array<{
    source: string;
    federal: number;
    state: number;
    total: number;
  }>;
  bracketDetail: Array<{
    rate: number;
    min: number;
    max: number | null;
    incomeInBracket: number;
    taxInBracket: number;
  }>;
  deductionComponents: Record<string, number>;
  fica: {
    totalSSTax: number;
    totalMedicareTax: number;
    totalFICA: number;
    bySource: Array<{ source: string; ssTax: number; medicareTax: number }>;
  };
  healthcareTaxImpact: HealthcareTaxImpact;
}

function extractHealthcareTaxImpact(
  year: number,
  taxManager: TaxManager,
  acaManager: AcaManager,
  medicareManager: MedicareManager,
  deductionTracker: DeductionTracker,
  simulation: string,
): HealthcareTaxImpact {
  // Load person configs
  let personConfigs;
  try {
    personConfigs = getPersonConfigs();
  } catch {
    // No person configs available -- return null phase
    return {
      phase: null, estimatedMAGI: 0,
      cobraMonthlyPremium: null, acaGrossMonthlyPremium: null,
      acaMonthlySubsidy: null, acaNetMonthlyPremium: null,
      medicarePartBPremium: null, medicarePartDPremium: null,
      medicareIrmaaPartBSurcharge: null, medicareIrmaaPartDSurcharge: null,
      medicareTotalMonthly: null, hsaContribution: 0, totalAnnualCost: 0,
    };
  }

  const personBirthYears: Record<string, number> = {};
  let retireDate: Date;
  try {
    for (const p of personConfigs) {
      personBirthYears[p.name] = getPersonBirthDate(p.name).getUTCFullYear();
    }
    const retireDates = personConfigs.map(p => getPersonRetirementDate(p.name));
    retireDate = new Date(Math.min(...retireDates.map(d => d.getTime())));
  } catch {
    return {
      phase: null, estimatedMAGI: 0,
      cobraMonthlyPremium: null, acaGrossMonthlyPremium: null,
      acaMonthlySubsidy: null, acaNetMonthlyPremium: null,
      medicarePartBPremium: null, medicarePartDPremium: null,
      medicareIrmaaPartBSurcharge: null, medicareIrmaaPartDSurcharge: null,
      medicareTotalMonthly: null, hsaContribution: 0, totalAnnualCost: 0,
    };
  }

  const retirementYear = retireDate.getUTCFullYear();

  // If year is before retirement, no healthcare costs apply
  if (year < retirementYear) {
    return {
      phase: null, estimatedMAGI: 0,
      cobraMonthlyPremium: null, acaGrossMonthlyPremium: null,
      acaMonthlySubsidy: null, acaNetMonthlyPremium: null,
      medicarePartBPremium: null, medicarePartDPremium: null,
      medicareIrmaaPartBSurcharge: null, medicareIrmaaPartDSurcharge: null,
      medicareTotalMonthly: null, hsaContribution: 0, totalAnnualCost: 0,
    };
  }

  // Person ages and phase determination (mirrors projections.ts:135-169)
  const personAges: { name: string; age: number }[] = [];
  for (const [name, birthYear] of Object.entries(personBirthYears)) {
    personAges.push({ name, age: year - birthYear });
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const isCobraPeriod = acaManager.isCobraPeriod(retireDate, yearStart);
  const medicarePersons = personAges.filter(p => p.age >= 65);
  const nonMedicarePersons = personAges.filter(p => p.age < 65);
  const allMedicare = medicarePersons.length === personAges.length;

  let phase: HealthcareTaxImpact['phase'];
  if (isCobraPeriod) {
    phase = 'cobra';
  } else if (allMedicare) {
    phase = 'medicare';
  } else if (medicarePersons.length > 0) {
    phase = 'split';
  } else {
    phase = 'aca';
  }

  // MAGI from prior-year tax occurrences (mirrors projections.ts:145-150)
  const priorYearOccurrences = taxManager.getAllOccurrencesForYear(year - 1);
  let estimatedMAGI = 0;
  for (const occ of priorYearOccurrences) {
    if (occ.incomeType !== 'penalty') {
      estimatedMAGI += occ.amount;
    }
  }

  // Filing status
  let filingStatus: 'mfj' | 'single' = 'mfj';
  try {
    const taxConfig = load<{ filingStatus: string }>('taxConfig.json');
    filingStatus = taxConfig.filingStatus === 'mfj' ? 'mfj' : 'single';
  } catch { /* default mfj */ }

  // COBRA base premium override
  let cobraBasePremium: number | undefined;
  try {
    const configs = loadAllHealthcareConfigs(simulation);
    const employerConfig = configs.find(c => c.monthlyPremium && c.monthlyPremium > 0);
    cobraBasePremium = employerConfig?.monthlyPremium;
  } catch { /* no override */ }

  const householdSize = personConfigs.length;

  // Initialize all fields
  let cobraMonthlyPremium: number | null = null;
  let acaGrossMonthlyPremium: number | null = null;
  let acaMonthlySubsidy: number | null = null;
  let acaNetMonthlyPremium: number | null = null;
  let medicarePartBPremium: number | null = null;
  let medicarePartDPremium: number | null = null;
  let medicareIrmaaPartBSurcharge: number | null = null;
  let medicareIrmaaPartDSurcharge: number | null = null;
  let medicareTotalMonthly: number | null = null;
  let totalAnnualCost = 0;

  // Phase-specific calculations (mirrors projections.ts:183-244)
  if (phase === 'cobra') {
    cobraMonthlyPremium = acaManager.getCobraMonthlyPremium(year, cobraBasePremium);
    totalAnnualCost = cobraMonthlyPremium * 12;
  }

  if (phase === 'aca') {
    if (personAges.length === 1) {
      acaGrossMonthlyPremium = acaManager.getAcaPremiumForPerson(personAges[0].age, year);
    } else {
      acaGrossMonthlyPremium = acaManager.getAcaCoupleGrossPremium(personAges[0].age, personAges[1].age, year);
    }
    acaMonthlySubsidy = acaManager.calculateMonthlySubsidy(estimatedMAGI, householdSize, year, acaGrossMonthlyPremium);
    acaNetMonthlyPremium = Math.max(0, acaGrossMonthlyPremium - acaMonthlySubsidy);
    totalAnnualCost = acaNetMonthlyPremium * 12;
  }

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

  if (phase === 'split') {
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

    if (nonMedicarePersons.length === 1) {
      acaGrossMonthlyPremium = acaManager.getAcaPremiumForPerson(nonMedicarePersons[0].age, year);
    } else {
      acaGrossMonthlyPremium = acaManager.getAcaCoupleGrossPremium(
        nonMedicarePersons[0].age, nonMedicarePersons[1].age, year
      );
    }
    acaMonthlySubsidy = acaManager.calculateMonthlySubsidy(estimatedMAGI, householdSize, year, acaGrossMonthlyPremium);
    acaNetMonthlyPremium = Math.max(0, acaGrossMonthlyPremium - acaMonthlySubsidy);
    totalAnnualCost = (totalMedicareCost + acaNetMonthlyPremium) * 12;
  }

  // HSA contribution from deduction tracker
  const deductions = deductionTracker.getDeductionsByCategory(year);
  const hsaContribution = deductions['hsaContribution'] ?? 0;

  return {
    phase, estimatedMAGI,
    cobraMonthlyPremium, acaGrossMonthlyPremium,
    acaMonthlySubsidy, acaNetMonthlyPremium,
    medicarePartBPremium, medicarePartDPremium,
    medicareIrmaaPartBSurcharge, medicareIrmaaPartDSurcharge,
    medicareTotalMonthly, hsaContribution, totalAnnualCost,
  };
}

export async function getTaxDetail(request: Request): Promise<TaxDetailResponse> {
  const simulation = (request.query.simulation as string) || 'Default';
  const year = Number(request.params.year);

  if (!year || isNaN(year)) {
    throw new Error('Invalid year parameter');
  }

  // Use April 1 of next year to ensure March tax events (RMDs, ACA, etc.) have fired
  const endDate = new Date(Date.UTC(year + 1, 3, 1));

  const rawData = getAccountsAndTransfers(simulation);

  const { engine } = await calculateAllActivityWithEngine(
    rawData,
    null, // Start from simulation start to accumulate carryforwards
    endDate,
    simulation,
    false, // not MC
    1,
    1,
    true, // tax detail needs fully-initialized engine; cache doesn't preserve managers
    false, // logging
  );

  const taxManager = engine.getTaxManager();
  const deductionTracker = engine.getDeductionTracker();
  const acaManager = engine.getAcaManager();
  const medicareManager = engine.getMedicareManager();
  const loadedProfile = loadTaxProfile();
  const taxProfile: TaxProfile = {
    filingStatus: loadedProfile.filingStatus,
    state: loadedProfile.state,
    stateTaxRate: loadedProfile.stateTaxRate,
    stateStandardDeduction: loadedProfile.stateStandardDeduction,
    stateAllowances: loadedProfile.stateAllowances,
    dependents: (loadedProfile.dependents ?? [])
      .filter((d: any) => d.relationship !== 'parent')
      .map((d: any) => ({ name: d.name, birthYear: d.birthYear, relationship: d.relationship as 'child' | 'other' })),
    itemizationMode: loadedProfile.itemizationMode,
  };

  // 1. Base reconciliation
  const reconciliation = taxManager.computeReconciliation(
    year,
    taxProfile,
    deductionTracker,
    0.03,
  );

  // 2. Income by account (resolve IDs to names)
  const incomeByAccountRaw = taxManager.getIncomeByAccount(year);
  const accountNameMap = new Map<string, string>();
  for (const account of rawData.accounts) {
    accountNameMap.set(account.id, account.name);
  }
  const incomeByAccount = Object.entries(incomeByAccountRaw).map(([accountId, incomeByType]) => ({
    accountId,
    accountName: accountNameMap.get(accountId) ?? accountId,
    incomeByType,
    total: Object.values(incomeByType).reduce((sum, v) => sum + v, 0),
  }));

  // 3. Withholding by source
  const withholdingBySourceRaw = taxManager.getWithholdingBySource(year);
  const withholdingBySource = withholdingBySourceRaw.map((w) => ({
    ...w,
    total: w.federal + w.state,
  }));

  // 4. Bracket detail
  const yearData = getBracketDataForYear(year, taxProfile.filingStatus, 0.03);
  const brackets = yearData.brackets[taxProfile.filingStatus];
  const bracketDetail = calculateProgressiveTaxDetailed(reconciliation.taxableIncome, brackets);

  // 5. Deduction components
  const deductionComponents = deductionTracker.getDeductionsByCategory(year);

  // 6. FICA totals
  const fica = taxManager.getFicaTotals(year);

  // 7. Healthcare tax impact
  const healthcareTaxImpact = extractHealthcareTaxImpact(
    year,
    taxManager,
    acaManager,
    medicareManager,
    deductionTracker,
    simulation,
  );

  return {
    reconciliation,
    incomeByAccount,
    withholdingBySource,
    bracketDetail,
    deductionComponents,
    fica,
    healthcareTaxImpact,
  };
}
