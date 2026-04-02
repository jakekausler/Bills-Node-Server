import { Request } from 'express';
import { getAccountsAndTransfers } from '../../utils/io/accountsAndTransfers';
import { calculateAllActivityWithEngine } from '../../utils/calculate-v3/engine';
import { loadTaxProfile } from '../../utils/io/taxProfile';
import { getBracketDataForYear, calculateProgressiveTaxDetailed } from '../../utils/calculate-v3/bracket-calculator';
import type { TaxReconciliation } from '../../utils/calculate-v3/types';
import type { TaxProfile } from '../../utils/calculate-v3/tax-profile-types';

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

  return {
    reconciliation,
    incomeByAccount,
    withholdingBySource,
    bracketDetail,
    deductionComponents,
    fica,
  };
}
