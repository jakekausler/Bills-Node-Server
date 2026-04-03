import { Request } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../utils/simulation/variable';
import { loadRawPensionAndSS } from '../../utils/io/retirement';
import { getAccountsAndTransfers } from '../../utils/io/accountsAndTransfers';
import { calculateAllActivityWithEngine } from '../../utils/calculate-v3/engine';
import { getProjectionsCache, setProjectionsCache } from '../../utils/io/projectionsCache';

dayjs.extend(utc);

export interface PersonBenefit {
  name: string;
  annualAmount: number;
  realAnnualAmount: number;
  startYear: number | null;
}

export interface RetirementProjectionYear {
  year: number;
  jakeAge: number;
  kendallAge: number;
  socialSecurity: PersonBenefit[];
  pensions: PersonBenefit[];
  rmdTotal: number;
  rothConversionTotal: number;
  totalRetirementIncome: number;
  // Real versions
  realRmdTotal: number;
  realRothConversionTotal: number;
  realTotalRetirementIncome: number;
}

export interface RetirementProjectionResponse {
  projections: RetirementProjectionYear[];
  retirementYear: number;
  projectionEndYear: number;
  socialSecurityConfigs: { name: string; startYear: number | null; monthlyPay: number }[];
  pensionConfigs: { name: string; startYear: number | null; monthlyPay: number }[];
}

export async function getRetirementProjections(request: Request): Promise<RetirementProjectionResponse> {
  const simulation = (request.query.simulation as string) || 'Default';
  const targetAge = parseInt((request.query.targetAge as string) || '90', 10);

  // Check cache
  const cacheKey = `${simulation}-${targetAge}`;
  const cached = getProjectionsCache(cacheKey);
  if (cached) {
    return cached;
  }

  // Load person variables
  let jakeBirthDate: Date;
  let kendallBirthDate: Date;
  let retireDate: Date;

  try {
    jakeBirthDate = loadVariable('JAKE_BIRTH_DATE', simulation) as Date;
    kendallBirthDate = loadVariable('KENDALL_BIRTH_DATE', simulation) as Date;
    retireDate = loadVariable('RETIRE_DATE', simulation) as Date;
  } catch (e) {
    throw new Error('Missing required variables: JAKE_BIRTH_DATE, KENDALL_BIRTH_DATE, RETIRE_DATE');
  }

  const jakeBirthYear = jakeBirthDate.getUTCFullYear();
  const kendallBirthYear = kendallBirthDate.getUTCFullYear();
  const retirementYear = retireDate.getUTCFullYear();

  // Project until older person reaches targetAge
  const earlierBirthYear = Math.min(jakeBirthYear, kendallBirthYear);
  const projectionEndYear = earlierBirthYear + targetAge;

  // Load inflation rate for real value calculation
  let inflationRate = 0.03; // default 3%
  try {
    const inflVar = loadVariable('INFLATION_RATE', simulation);
    if (typeof inflVar === 'number') {
      inflationRate = inflVar;
    }
  } catch { /* use default */ }

  // Run engine
  const startDate = new Date(Date.UTC(retirementYear, 0, 1));
  const endDate = new Date(Date.UTC(projectionEndYear, 11, 31));
  const rawData = getAccountsAndTransfers(simulation);

  const { engine } = await calculateAllActivityWithEngine(
    rawData,
    startDate,
    endDate,
    simulation,
    false, // not MC
    1, 1,
    true,  // force recalculation
    false, // logging
  );

  const retirementManager = engine.getRetirementManager();
  const flowAggregator = engine.getFlowAggregator();

  // Get all SS and pension names
  const ssNames = retirementManager.getSocialSecurityNames();
  const pensionNames = retirementManager.getPensionNames();

  // Build SS and pension config arrays with monthly pay and start years
  const socialSecurityConfigs = ssNames.map((name) => ({
    name,
    startYear: retirementManager.getSocialSecurityFirstPaymentYear(name),
    monthlyPay: retirementManager.getSocialSecurityMonthlyPay(name),
  }));

  const pensionConfigs = pensionNames.map((name) => ({
    name,
    startYear: retirementManager.getPensionFirstPaymentYear(name),
    monthlyPay: retirementManager.getPensionMonthlyPay(name),
  }));

  const ssPayMap = new Map(socialSecurityConfigs.map(c => [c.name, { monthlyPay: c.monthlyPay, startYear: c.startYear }]));
  const pensionPayMap = new Map(pensionConfigs.map(c => [c.name, { monthlyPay: c.monthlyPay, startYear: c.startYear }]));

  // Build COLA variable map for SS benefit compounding
  const rawPensionSS = loadRawPensionAndSS();
  const ssColaVariableMap = new Map<string, string | null>(
    rawPensionSS.socialSecurities.map((ss: any) => [ss.name, ss.colaVariable ?? null])
  );

  // Build COLA map for pension benefit compounding
  const pensionColaMap = new Map<string, { type: string; fixedRate?: number; cpiCap?: number }>(
    rawPensionSS.pensions.map((p: any) => [p.name, p.cola || { type: 'none' }])
  );

  // Build projections
  const projections: RetirementProjectionYear[] = [];
  let cumulativeInflation = 1.0;
  const baseYear = retirementYear;

  for (let year = retirementYear; year <= projectionEndYear; year++) {
    if (year > baseYear) {
      cumulativeInflation *= (1 + inflationRate);
    }

    const jakeAge = year - jakeBirthYear;
    const kendallAge = year - kendallBirthYear;

    // Build SS benefits array
    const socialSecurity: PersonBenefit[] = ssNames.map((name) => {
      const cached = ssPayMap.get(name);
      const monthlyPay = cached?.monthlyPay ?? 0;
      const startYear = cached?.startYear ?? null;
      let annualAmount = 0;
      if (startYear && year >= startYear) {
        const colaVarName = ssColaVariableMap.get(name) ?? null;
        const colaRate = colaVarName
          ? ((loadVariable(colaVarName, simulation) as number) || 0)
          : 0;
        const yearsCollecting = year - startYear;
        const colaMultiplier = colaRate > 0 ? Math.pow(1 + colaRate, yearsCollecting) : 1;
        annualAmount = monthlyPay * 12 * colaMultiplier;
      }
      const deflator = 1 / cumulativeInflation;
      return {
        name,
        annualAmount,
        realAnnualAmount: annualAmount * deflator,
        startYear,
      };
    });

    // Build pension benefits array
    const pensions: PersonBenefit[] = pensionNames.map((name) => {
      const cached = pensionPayMap.get(name);
      const monthlyPay = cached?.monthlyPay ?? 0;
      const startYear = cached?.startYear ?? null;
      let annualAmount = 0;
      if (startYear && year >= startYear) {
        const cola = pensionColaMap.get(name) ?? { type: 'none' };
        const yearsCollecting = year - startYear;
        let colaMultiplier = 1;
        if (cola.type === 'fixed' && cola.fixedRate) {
          colaMultiplier = Math.pow(1 + cola.fixedRate / 100, yearsCollecting);
        } else if (cola.type === 'cpiLinked') {
          const cap = (cola.cpiCap ?? 100) / 100;
          const effectiveRate = Math.min(inflationRate, cap);
          colaMultiplier = Math.pow(1 + effectiveRate, yearsCollecting);
        }
        annualAmount = monthlyPay * 12 * colaMultiplier;
      }
      const deflator = 1 / cumulativeInflation;
      return {
        name,
        annualAmount,
        realAnnualAmount: annualAmount * deflator,
        startYear,
      };
    });

    // RMD and Roth from flow aggregator
    const yearFlows = flowAggregator?.getYearSummary(year);
    const rmdTotal = yearFlows?.transfers.rmdDistributions ?? 0;
    const rothConversionTotal = yearFlows?.transfers.rothConversions ?? 0;

    // Total retirement income: SS + Pension + RMD (exclude Roth conversions from income)
    const ssTotal = socialSecurity.reduce((sum, s) => sum + s.annualAmount, 0);
    const pensionTotal = pensions.reduce((sum, p) => sum + p.annualAmount, 0);
    const totalRetirementIncome = ssTotal + pensionTotal + rmdTotal;

    const deflator = 1 / cumulativeInflation;

    projections.push({
      year,
      jakeAge,
      kendallAge,
      socialSecurity,
      pensions,
      rmdTotal,
      rothConversionTotal,
      totalRetirementIncome,
      realRmdTotal: rmdTotal * deflator,
      realRothConversionTotal: rothConversionTotal * deflator,
      realTotalRetirementIncome: totalRetirementIncome * deflator,
    });
  }

  const response: RetirementProjectionResponse = {
    projections,
    retirementYear,
    projectionEndYear,
    socialSecurityConfigs,
    pensionConfigs,
  };
  setProjectionsCache(cacheKey, response);
  return response;
}
