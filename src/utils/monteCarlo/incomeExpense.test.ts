import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeIncomeExpense } from './incomeExpense';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'fs/promises';

const mockReadFile = vi.mocked(readFile);

const VALID_UUID = 'aabbccdd-1234-5678-9abc-def012345678';

interface FlowSummary {
  income: Record<string, number>;
  expenses: {
    bills: Record<string, number>;
    taxes: { federal: number; penalty: number };
    healthcare: {
      cobra: number;
      aca: number;
      medicare: number;
      hospital: number;
      ltcInsurance: number;
      ltcCare: number;
      outOfPocket: number;
      hsaReimbursements: number;
    };
  };
  transfers: { rothConversions: number; rmdDistributions: number; autoPulls: number; autoPushes: number };
  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  startingBalance: number;
  endingBalance: number;
  totalInterestEarned: number;
}

function makeFlow(overrides: Partial<{
  income: Record<string, number>;
  bills: Record<string, number>;
  federal: number;
  penalty: number;
  totalIncome: number;
  totalExpenses: number;
}>): FlowSummary {
  const income = overrides.income ?? {};
  const bills = overrides.bills ?? {};
  const federal = overrides.federal ?? 0;
  const penalty = overrides.penalty ?? 0;
  const totalIncome = overrides.totalIncome ?? Object.values(income).reduce((a, b) => a + b, 0);
  const totalExpenses = overrides.totalExpenses ?? (Object.values(bills).reduce((a, b) => a + b, 0) + federal + penalty);

  return {
    income,
    expenses: {
      bills,
      taxes: { federal, penalty },
      healthcare: { cobra: 0, aca: 0, medicare: 0, hospital: 0, ltcInsurance: 0, ltcCare: 0, outOfPocket: 0, hsaReimbursements: 0 },
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
  yearlyFlows: Record<string, FlowSummary>,
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
    for (let yearIdx = 0; yearIdx < result.labels.length; yearIdx++) {
      for (let i = 0; i < pKeys.length - 1; i++) {
        expect(result.incomeFan[pKeys[i]][yearIdx]).toBeLessThanOrEqual(
          result.incomeFan[pKeys[i + 1]][yearIdx],
        );
      }
    }
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
    for (let yearIdx = 0; yearIdx < result.labels.length; yearIdx++) {
      for (let i = 0; i < pKeys.length - 1; i++) {
        expect(result.expenseFan[pKeys[i]][yearIdx]).toBeLessThanOrEqual(
          result.expenseFan[pKeys[i + 1]][yearIdx],
        );
      }
    }
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
    // Real income fan p50 for 2027 = 110000/1.1 = 100000
    expect(result.realIncomeFan['p50'][1]).toBeCloseTo(100000);
    // Real expense fan p50 for 2027 = 55000/1.1 = 50000
    expect(result.realExpenseFan['p50'][1]).toBeCloseTo(50000);
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
});
