import { HealthcareConfig } from '../../data/healthcare/types';
import { loadPensionsAndSocialSecurity } from './retirement';
import { loadHealthcareConfigs } from './healthcareConfigs';
import { loadVariable } from '../simulation/variable';
import { getPersonBirthDate, getPersonConfigs, getPersonRetirementDate } from '../../api/person-config/person-config';
import { AcaManager } from '../calculate-v3/aca-manager';
import { getPersonNames } from './persons';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

/**
 * Generate virtual healthcare plans (ACA Silver + Medicare) based on
 * retirement date and birth dates from social security configs.
 *
 * These plans fill coverage gaps that aren't covered by user-defined configs:
 * - ACA Silver: covers the gap between retirement and age 65
 * - Medicare: covers age 65+
 *
 * Virtual plans have deterministic IDs (not random) so they are stable across calls.
 *
 * @param simulation - The simulation name to load variables from
 * @returns Array of virtual HealthcareConfig objects (may be empty)
 */
export function generateVirtualHealthcarePlans(simulation: string): HealthcareConfig[] {
  const virtualPlans: HealthcareConfig[] = [];
  const existingConfigs = loadHealthcareConfigs();

  // Load social security configs to get birth dates
  let birthDates: Date[] = [];
  try {
    const { socialSecurities } = loadPensionsAndSocialSecurity(simulation);
    for (const ss of socialSecurities) {
      try {
        const birthDate = getPersonBirthDate(ss.person);
        birthDates.push(birthDate);
      } catch (e) {
        // Skip if birth date not found
      }
    }
  } catch (e) {
    // If retirement data loading fails, return empty
    return virtualPlans;
  }

  if (birthDates.length < 2) {
    return virtualPlans;
  }

  // Find HSA account ID from existing configs for reimbursement on virtual plans
  const hsaAccountId = existingConfigs.find(c => c.hsaAccountId)?.hsaAccountId ?? null;

  // Calculate age 65 dates
  const age65Date1 = dayjs.utc(birthDates[0]).add(65, 'year').toDate();
  const age65Date2 = dayjs.utc(birthDates[1]).add(65, 'year').toDate();
  const laterAge65Date = age65Date1 > age65Date2 ? age65Date1 : age65Date2;
  const earlierAge65Date = age65Date1 < age65Date2 ? age65Date1 : age65Date2;

  // --- Virtual ACA Silver Plan ---
  try {
    // Use earliest retirement date from person configs
    const personConfigs = getPersonConfigs();
    let retireDate: Date | null = null;
    for (const pc of personConfigs) {
      try {
        const rd = getPersonRetirementDate(pc.name);
        if (!retireDate || rd < retireDate) retireDate = rd;
      } catch (e) { /* skip */ }
    }

    if (retireDate && retireDate < laterAge65Date) {
      // Resolve variable dates on existing configs before gap detection
      const resolvedConfigs = existingConfigs.map(config => {
        let startDate = config.startDate;
        let endDate = config.endDate;
        try {
          if (config.startDateIsVariable && config.startDateVariable) {
            const resolved = loadVariable(config.startDateVariable, simulation);
            if (resolved instanceof Date) startDate = resolved.toISOString().split('T')[0];
          }
        } catch { /* variable not found, keep original */ }
        try {
          if (config.endDateIsVariable && config.endDateVariable) {
            const resolved = loadVariable(config.endDateVariable, simulation);
            if (resolved instanceof Date) endDate = resolved.toISOString().split('T')[0];
          }
        } catch { /* variable not found, keep original */ }
        return { ...config, startDate, endDate };
      });

      // Check if an existing plan already covers the retirement-to-65 gap
      const hasCoverageDuringGap = resolvedConfigs.some(config => {
        const configStartDate = new Date(config.startDate);
        const configEndDate = config.endDate ? new Date(config.endDate) : null;
        return (
          configStartDate <= retireDate &&
          (!configEndDate || configEndDate >= laterAge65Date)
        );
      });

      if (!hasCoverageDuringGap) {
        const acaManager = new AcaManager();
        const retireYear = retireDate.getUTCFullYear();
        const acaDeductible = acaManager.getAcaDeductible(retireYear);
        const acaOOPMax = acaManager.getAcaOOPMax(retireYear);

        // Check if there is an employer plan ending at/near retirement
        const employerPlanAtRetirement = resolvedConfigs.find(config => {
          if (!config.endDate) return false;
          const configEnd = new Date(config.endDate);
          const diffMs = Math.abs(configEnd.getTime() - retireDate.getTime());
          const diffDays = diffMs / (1000 * 60 * 60 * 24);
          return diffDays <= 31;
        }) ?? null;

        const cobraEndDate = dayjs.utc(retireDate).add(18, 'month').toDate();

        if (employerPlanAtRetirement) {
          // --- Virtual COBRA Plan ---
          const virtualCobraPlan: HealthcareConfig = {
            id: 'virtual-cobra',
            name: 'COBRA (Virtual)',
            coveredPersons: getPersonNames(),
            startDate: retireDate.toISOString().split('T')[0],
            startDateIsVariable: false,
            endDate: cobraEndDate.toISOString().split('T')[0],
            endDateIsVariable: false,
            individualDeductible: employerPlanAtRetirement.individualDeductible ?? 0,
            individualOutOfPocketMax: employerPlanAtRetirement.individualOutOfPocketMax ?? 0,
            familyDeductible: employerPlanAtRetirement.familyDeductible ?? 0,
            familyOutOfPocketMax: employerPlanAtRetirement.familyOutOfPocketMax ?? 0,
            hsaAccountId: employerPlanAtRetirement.hsaAccountId ?? hsaAccountId,
            hsaReimbursementEnabled: !!(employerPlanAtRetirement.hsaAccountId ?? hsaAccountId),
            resetMonth: 1,
            resetDay: 1,
            deductibleInflationRate: 0.05,
          };
          virtualPlans.push(virtualCobraPlan);
        }

        // ACA Silver starts after COBRA ends
        const acaStartDate = cobraEndDate;
        const virtualAcaPlan: HealthcareConfig = {
          id: 'virtual-aca-silver',
          name: 'ACA Silver Plan (Virtual)',
          coveredPersons: getPersonNames(),
          startDate: acaStartDate.toISOString().split('T')[0],
          startDateIsVariable: false,
          endDate: laterAge65Date.toISOString().split('T')[0],
          endDateIsVariable: false,
          individualDeductible: Math.round(acaDeductible.individual),
          individualOutOfPocketMax: Math.round(acaOOPMax.individual),
          familyDeductible: Math.round(acaDeductible.family),
          familyOutOfPocketMax: Math.round(acaOOPMax.family),
          hsaAccountId: hsaAccountId,
          hsaReimbursementEnabled: !!hsaAccountId,
          resetMonth: 1,
          resetDay: 1,
          deductibleInflationRate: 0.05,
        };

        virtualPlans.push(virtualAcaPlan);
      }
    }
  } catch (e) {
    // If retirement date lookup fails, skip ACA plan
  }

  // --- Virtual Medicare Plan ---
  try {
    // Check if no plan already covers Medicare
    const hasMedicareEquivalent = existingConfigs.some(config => {
      const configName = (config.name || '').toLowerCase();
      return configName.includes('medicare');
    });

    if (!hasMedicareEquivalent) {
      // Pre-inflate from base year (last known data year) to plan start year
      // Medicare Part B deductible: 3.2% annual change based on 59 years of historical data
      // OOP: 5.0% annual change (tracks healthcare CPI more closely)
      const baseYear = 2024;
      const medicareStartYear = earlierAge65Date.getUTCFullYear();
      const yearsToInflate = Math.max(0, medicareStartYear - baseYear);
      const medicareDeductibleInflator = Math.pow(1.032, yearsToInflate);
      const medicareOOPInflator = Math.pow(1.05, yearsToInflate);

      const virtualMedicarePlan: HealthcareConfig = {
        id: 'virtual-medicare',
        name: 'Medicare Plan (Virtual)',
        coveredPersons: getPersonNames(),
        startDate: earlierAge65Date.toISOString().split('T')[0],
        startDateIsVariable: false,
        endDate: null,
        endDateIsVariable: false,
        individualDeductible: Math.round(240 * medicareDeductibleInflator), // 2024 Part B deductible
        individualOutOfPocketMax: Math.round(5000 * medicareOOPInflator), // Effective OOP with Medigap
        familyDeductible: Math.round(480 * medicareDeductibleInflator), // 2 × individual
        familyOutOfPocketMax: Math.round(10000 * medicareOOPInflator), // 2 × individual
        hsaAccountId: hsaAccountId,
        hsaReimbursementEnabled: !!hsaAccountId, // HSA can reimburse at 65+
        resetMonth: 1,
        resetDay: 1,
        deductibleInflationRate: 0.05, // 5% healthcare CPI
      };

      virtualPlans.push(virtualMedicarePlan);
    }
  } catch (e) {
    // If variable loading fails, skip Medicare plan
  }

  return virtualPlans;
}

/**
 * Load all healthcare configs including virtual plans.
 *
 * @param simulation - The simulation name (needed for virtual plan generation)
 * @returns Array of all healthcare configs (user-defined + virtual)
 */
export function loadAllHealthcareConfigs(simulation: string): HealthcareConfig[] {
  const configs = loadHealthcareConfigs();
  const virtualPlans = generateVirtualHealthcarePlans(simulation);
  return [...configs, ...virtualPlans];
}
