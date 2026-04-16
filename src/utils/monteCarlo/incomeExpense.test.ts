import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeIncomeExpense } from './incomeExpense';
import { YearlyFlowSummary } from '../calculate-v3/flow-aggregator';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';

const mockReadFile = vi.mocked(readFile);

const VALID_UUID = 'aabbccdd-1234-5678-9abc-def012345678';

function makeFlow(overrides: Partial<{
  income: Record<string, number>;
  bills: Record<string, number>;
  federal: number;
  penalty: number;
  cobra: number;
  medicare: number;
  outOfPocket: number;
  aca: number;
  hospital: number;
  ltcInsurance: number;
  ltcCare: number;
  hsaReimbursements: number;
  totalIncome: number;
  totalExpenses: number;
}>): YearlyFlowSummary {
  const income = overrides.income ?? {};
  const bills = overrides.bills ?? {};
  const federal = overrides.federal ?? 0;
  const penalty = overrides.penalty ?? 0;
  const cobra = overrides.cobra ?? 0;
  const medicare = overrides.medicare ?? 0;
  const outOfPocket = overrides.outOfPocket ?? 0;
  const aca = overrides.aca ?? 0;
  const hospital = overrides.hospital ?? 0;
  const ltcInsurance = overrides.ltcInsurance ?? 0;
  const ltcCare = overrides.ltcCare ?? 0;
  const hsaReimbursements = overrides.hsaReimbursements ?? 0;
  const healthcareTotal = cobra + medicare + outOfPocket + aca + hospital + ltcInsurance + ltcCare + hsaReimbursements;
  const totalIncome = overrides.totalIncome ?? Object.values(income).reduce((a, b) => a + b, 0);
  const totalExpenses = overrides.totalExpenses ?? (Object.values(bills).reduce((a, b) => a + b, 0) + federal + penalty + healthcareTotal);

  return {
    income,
    expenses: {
      bills,
      taxes: {
        federalIncome: federal,
        stateIncome: 0,
        capitalGains: 0,
        niit: 0,
        fica: 0,
        additionalMedicare: 0,
        penalty,
      },
      healthcare: { cobra, aca, medicare, hospital, ltcInsurance, ltcCare, outOfPocket, hsaReimbursements },
    },
    transfers: { rothConversions: 0, rmdDistributions: 0, autoPulls: 0, autoPushes: 0 },
    totalIncome,
    totalExpenses,
    netCashFlow: totalIncome - totalExpenses,
    startingBalance: 100000,
    endingBalance: 100000 + totalIncome - totalExpenses,
    totalInterestEarned: 0,
  };
}

function makeSim(
  num: number,
  yearlyFlows: Record<string, YearlyFlowSummary>,
  inflation?: Record<number, number>,
) {
  return {
    simulationNumber: num,
    yearlyMinBalances: {},
    cumulativeInflation: inflation,
    yearlyFlows,
  };
}

function buildResultsFile(results: ReturnType<typeof makeSim>[]) {
  return JSON.stringify({
    metadata: { startDate: '2026-01-01', endDate: '2028-12-31', seed: 42 },
    results,
  });
}

describe('computeIncomeExpense', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct breakdown at 50th percentile', async () => {
    // 3 sims, 2 years. At p50 we should get the median value.
    const sims = [
      makeSim(1, {
        '2026': makeFlow({ income: { Salary: 70000 }, bills: { Housing: 30000 }, federal: 10000, totalIncome: 70000, totalExpenses: 40000 }),
        '2027': makeFlow({ income: { Salary: 72000 }, bills: { Housing: 31000 }, federal: 11000, totalIncome: 72000, totalExpenses: 42000 }),
      }),
      makeSim(2, {
        '2026': makeFlow({ income: { Salary: 80000 }, bills: { Housing: 35000 }, federal: 12000, totalIncome: 80000, totalExpenses: 47000 }),
        '2027': makeFlow({ income: { Salary: 82000 }, bills: { Housing: 36000 }, federal: 13000, totalIncome: 82000, totalExpenses: 49000 }),
      }),
      makeSim(3, {
        '2026': makeFlow({ income: { Salary: 90000 }, bills: { Housing: 40000 }, federal: 15000, totalIncome: 90000, totalExpenses: 55000 }),
        '2027': makeFlow({ income: { Salary: 92000 }, bills: { Housing: 41000 }, federal: 16000, totalIncome: 92000, totalExpenses: 57000 }),
      }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID, 50);

    // Median of [70000, 80000, 90000] = 80000
    expect(result.breakdown.income['Salary'][0]).toBe(80000);
    // Median of [72000, 82000, 92000] = 82000
    expect(result.breakdown.income['Salary'][1]).toBe(82000);
    // Median Housing: [30000, 35000, 40000] = 35000
    expect(result.breakdown.expenses['Housing'][0]).toBe(35000);
    // Median Taxes: [10000, 12000, 15000] = 12000
    expect(result.breakdown.expenses['Taxes'][0]).toBe(12000);
    expect(result.labels).toEqual(['2026', '2027']);
  });

  it('income fan percentiles are in correct order (p0 <= p5 <= ... <= p100)', async () => {
    // Create sims with spread of income
    const sims = Array.from({ length: 20 }, (_, i) =>
      makeSim(i + 1, {
        '2026': makeFlow({ income: { Salary: 50000 + i * 5000 }, totalIncome: 50000 + i * 5000, totalExpenses: 30000 }),
      }),
    );
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID);

    const pKeys = ['p0', 'p5', 'p25', 'p40', 'p50', 'p60', 'p75', 'p95', 'p100'];
    const totalIncomeFan = result.incomeFan['Total'];
    for (let yearIdx = 0; yearIdx < result.labels.length; yearIdx++) {
      for (let i = 0; i < pKeys.length - 1; i++) {
        expect(totalIncomeFan[pKeys[i]][yearIdx]).toBeLessThanOrEqual(
          totalIncomeFan[pKeys[i + 1]][yearIdx],
        );
      }
    }
    // Per-category fan should also exist
    expect(result.incomeFan['Salary']).toBeDefined();
  });

  it('expense fan percentiles are in correct order', async () => {
    const sims = Array.from({ length: 20 }, (_, i) =>
      makeSim(i + 1, {
        '2026': makeFlow({ bills: { Housing: 20000 + i * 1000 }, totalIncome: 50000, totalExpenses: 20000 + i * 1000 }),
      }),
    );
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID);

    const pKeys = ['p0', 'p5', 'p25', 'p40', 'p50', 'p60', 'p75', 'p95', 'p100'];
    const totalExpenseFan = result.expenseFan['Total'];
    for (let yearIdx = 0; yearIdx < result.labels.length; yearIdx++) {
      for (let i = 0; i < pKeys.length - 1; i++) {
        expect(totalExpenseFan[pKeys[i]][yearIdx]).toBeLessThanOrEqual(
          totalExpenseFan[pKeys[i + 1]][yearIdx],
        );
      }
    }
    // Per-category fan should also exist
    expect(result.expenseFan['Housing']).toBeDefined();
  });

  it('real values are deflated correctly', async () => {
    const sims = [
      makeSim(
        1,
        {
          '2026': makeFlow({ income: { Salary: 100000 }, totalIncome: 100000, totalExpenses: 50000 }),
          '2027': makeFlow({ income: { Salary: 110000 }, totalIncome: 110000, totalExpenses: 55000 }),
        },
        { 2026: 1.0, 2027: 1.1 },
      ),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID);

    // Year 2026: inflation=1.0, real = nominal
    expect(result.realBreakdown.income['Salary'][0]).toBeCloseTo(100000);
    // Year 2027: inflation=1.1, real = 110000/1.1 = 100000
    expect(result.realBreakdown.income['Salary'][1]).toBeCloseTo(100000);
    // Real income fan Total p50 for 2027 = 110000/1.1 = 100000
    expect(result.realIncomeFan['Total']['p50'][1]).toBeCloseTo(100000);
    // Real expense fan Total p50 for 2027 = 55000/1.1 = 50000
    expect(result.realExpenseFan['Total']['p50'][1]).toBeCloseTo(50000);
  });

  it('missing yearlyFlows throws error', async () => {
    const data = JSON.stringify({
      metadata: { startDate: '2026-01-01', endDate: '2028-12-31', seed: 42 },
      results: [{ simulationNumber: 1, yearlyMinBalances: { 2026: 100000 } }],
    });
    mockReadFile.mockResolvedValue(data as any);

    await expect(computeIncomeExpense(VALID_UUID)).rejects.toThrow('Flow data not available');
  });

  it('invalid simulationId throws error', async () => {
    await expect(computeIncomeExpense('../etc/passwd')).rejects.toThrow('Invalid simulation ID format');
    await expect(computeIncomeExpense('not-a-uuid')).rejects.toThrow('Invalid simulation ID format');
  });

  it('summary net cash flow = totalIncome - totalExpenses at each percentile', async () => {
    // 5 sims with different income/expense levels
    const sims = Array.from({ length: 5 }, (_, i) => {
      const income = 60000 + i * 10000;
      const expenses = 30000 + i * 5000;
      return makeSim(i + 1, {
        '2026': makeFlow({ income: { Salary: income }, bills: { Housing: expenses }, totalIncome: income, totalExpenses: expenses }),
      });
    });
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID);

    // Net cash flows for each sim: [30000, 35000, 40000, 45000, 50000]
    // These are sorted, so:
    // p50 of [30000,35000,40000,45000,50000] = 40000 (index 2)
    expect(result.summary.medianNetCashFlow[0]).toBe(40000);
    // p5 should be close to 30000 (lowest)
    expect(result.summary.p5NetCashFlow[0]).toBeLessThanOrEqual(result.summary.medianNetCashFlow[0]);
    // p95 should be close to 50000 (highest)
    expect(result.summary.p95NetCashFlow[0]).toBeGreaterThanOrEqual(result.summary.medianNetCashFlow[0]);

    // Verify the cumulative net cash flow equals the single year values (only 1 year)
    expect(result.summary.cumulativeNetCashFlow.median).toBe(result.summary.medianNetCashFlow[0]);
  });

  it('healthcare expense subcategories appear in flattened breakdown', async () => {
    const sims = [
      makeSim(1, {
        '2026': makeFlow({
          income: { Salary: 80000 },
          bills: { Housing: 20000 },
          cobra: 5000,
          medicare: 3000,
          outOfPocket: 1500,
          totalIncome: 80000,
          totalExpenses: 29500,
        }),
      }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID);

    expect(result.breakdown.expenses['COBRA'][0]).toBe(5000);
    expect(result.breakdown.expenses['Medicare'][0]).toBe(3000);
    expect(result.breakdown.expenses['Out of Pocket'][0]).toBe(1500);
    // Housing bill should also be present
    expect(result.breakdown.expenses['Housing'][0]).toBe(20000);
  });

  it('multi-source income breakdown across sims', async () => {
    const sims = [
      makeSim(1, {
        '2026': makeFlow({ income: { Salary: 60000, Pension: 10000 }, totalIncome: 70000, totalExpenses: 30000 }),
      }),
      makeSim(2, {
        '2026': makeFlow({ income: { Salary: 80000, Pension: 15000 }, totalIncome: 95000, totalExpenses: 40000 }),
      }),
      makeSim(3, {
        '2026': makeFlow({ income: { Salary: 70000, Pension: 12000 }, totalIncome: 82000, totalExpenses: 35000 }),
      }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID, 50);

    // Median Salary: [60000, 70000, 80000] = 70000
    expect(result.breakdown.income['Salary'][0]).toBe(70000);
    // Median Pension: [10000, 12000, 15000] = 12000
    expect(result.breakdown.income['Pension'][0]).toBe(12000);
  });

  it('real cumulative net cash flow is correctly deflated', async () => {
    // 2 years, single sim, known inflation
    const sims = [
      makeSim(
        1,
        {
          '2026': makeFlow({ income: { Salary: 100000 }, totalIncome: 100000, totalExpenses: 60000 }),
          '2027': makeFlow({ income: { Salary: 110000 }, totalIncome: 110000, totalExpenses: 66000 }),
        },
        { 2026: 1.0, 2027: 1.1 },
      ),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID);

    // Nominal net: 2026=40000, 2027=44000. Cumulative nominal = 84000
    expect(result.summary.cumulativeNetCashFlow.median).toBe(84000);

    // Real net: 2026=40000/1.0=40000, 2027=44000/1.1=40000. Real cumulative = 80000
    expect(result.realSummary.cumulativeNetCashFlow.median).toBeCloseTo(80000);
  });

  it('missing-year edge case defaults to 0 for sims without that year', async () => {
    // Sim 1 has 2026-2028, Sim 2 has only 2026-2027
    const sims = [
      makeSim(1, {
        '2026': makeFlow({ income: { Salary: 80000 }, totalIncome: 80000, totalExpenses: 40000 }),
        '2027': makeFlow({ income: { Salary: 82000 }, totalIncome: 82000, totalExpenses: 41000 }),
        '2028': makeFlow({ income: { Salary: 84000 }, totalIncome: 84000, totalExpenses: 42000 }),
      }),
      makeSim(2, {
        '2026': makeFlow({ income: { Salary: 90000 }, totalIncome: 90000, totalExpenses: 45000 }),
        '2027': makeFlow({ income: { Salary: 92000 }, totalIncome: 92000, totalExpenses: 46000 }),
        // No 2028 data
      }),
    ];
    mockReadFile.mockResolvedValue(buildResultsFile(sims) as any);

    const result = await computeIncomeExpense(VALID_UUID, 50);

    // 2028 should exist in labels
    expect(result.labels).toContain('2028');

    // For 2028 income: sim1=84000, sim2=0. Median of [0, 84000] with linear interp = 42000
    expect(result.breakdown.income['Salary'][2]).toBe(42000);

    // For 2028 fan Total p50 totalIncome: sim1=84000, sim2=0. Median = 42000
    expect(result.incomeFan['Total']['p50'][2]).toBe(42000);
  });
});
