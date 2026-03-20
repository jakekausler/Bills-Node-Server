/**
 * FlowAggregator — passive observer that accumulates per-year financial flow data
 * during engine calculation. Used by MC worker to capture YearlyFlowSummary without
 * post-processing consolidated activities.
 */

export interface YearlyFlowSummary {
  income: Record<string, number>;

  transfers: {
    rothConversions: number;
    rmdDistributions: number;
    autoPulls: number;
    autoPushes: number;
  };

  expenses: {
    bills: Record<string, number>; // keyed by bill category
    taxes: { federal: number; penalty: number };
    healthcare: {
      cobra: number;
      aca: number;
      medicare: number;
      hospital: number;
      ltcInsurance: number;
      ltcCare: number;
      outOfPocket: number;
      hsaReimbursements: number; // negative — reduces net healthcare cost
    };
  };

  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;
  startingBalance: number;
  endingBalance: number;
  totalInterestEarned: number;
}

type HealthcareType = 'cobra' | 'aca' | 'medicare' | 'hospital' | 'ltcInsurance' | 'ltcCare' | 'outOfPocket' | 'hsaReimbursements';
type TransferType = 'rothConversions' | 'rmdDistributions' | 'autoPulls' | 'autoPushes';

function createEmptySummary(): YearlyFlowSummary {
  return {
    income: {},
    transfers: {
      rothConversions: 0,
      rmdDistributions: 0,
      autoPulls: 0,
      autoPushes: 0,
    },
    expenses: {
      bills: {},
      taxes: { federal: 0, penalty: 0 },
      healthcare: {
        cobra: 0,
        aca: 0,
        medicare: 0,
        hospital: 0,
        ltcInsurance: 0,
        ltcCare: 0,
        outOfPocket: 0,
        hsaReimbursements: 0,
      },
    },
    totalIncome: 0,
    totalExpenses: 0,
    netCashFlow: 0,
    startingBalance: 0,
    endingBalance: 0,
    totalInterestEarned: 0,
  };
}

export class FlowAggregator {
  private years: Map<number, YearlyFlowSummary> = new Map();

  private getOrCreate(year: number): YearlyFlowSummary {
    let summary = this.years.get(year);
    if (!summary) {
      summary = createEmptySummary();
      this.years.set(year, summary);
    }
    return summary;
  }

  recordIncome(year: number, name: string, amount: number): void {
    const s = this.getOrCreate(year);
    s.income[name] = (s.income[name] || 0) + amount;
    s.totalIncome += amount;
  }

  recordExpense(year: number, category: string, amount: number): void {
    const s = this.getOrCreate(year);
    s.expenses.bills[category] = (s.expenses.bills[category] || 0) + amount;
    s.totalExpenses += amount;
  }

  recordTax(year: number, federal: number, penalty: number): void {
    const s = this.getOrCreate(year);
    s.expenses.taxes.federal = federal;
    s.expenses.taxes.penalty = penalty;
    s.totalExpenses += federal + penalty;
  }

  recordHealthcare(year: number, type: HealthcareType, amount: number): void {
    const s = this.getOrCreate(year);
    s.expenses.healthcare[type] += amount;
    if (type === 'hsaReimbursements') {
      // hsaReimbursements are negative values — they reduce total expenses
      s.totalExpenses -= amount;
    } else {
      s.totalExpenses += amount;
    }
  }

  recordTransfer(year: number, type: TransferType, amount: number): void {
    const s = this.getOrCreate(year);
    s.transfers[type] += amount;
  }

  recordInterest(year: number, amount: number): void {
    const s = this.getOrCreate(year);
    s.totalInterestEarned += amount;
  }

  setStartingBalance(year: number, balance: number): void {
    const s = this.getOrCreate(year);
    s.startingBalance = balance;
  }

  setEndingBalance(year: number, balance: number): void {
    const s = this.getOrCreate(year);
    s.endingBalance = balance;
  }

  getYearlyFlows(): Record<string, YearlyFlowSummary> {
    const result: Record<string, YearlyFlowSummary> = {};
    for (const [year, summary] of this.years) {
      summary.netCashFlow = summary.totalIncome - summary.totalExpenses;
      result[String(year)] = summary;
    }
    return result;
  }
}
