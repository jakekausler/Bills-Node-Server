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

export type HealthcareType = 'cobra' | 'aca' | 'medicare' | 'hospital' | 'ltcInsurance' | 'ltcCare' | 'outOfPocket' | 'hsaReimbursements';
export type TransferType = 'rothConversions' | 'rmdDistributions' | 'autoPulls' | 'autoPushes';

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

  private validateAmount(amount: number, context: string): void {
    if (!Number.isFinite(amount)) {
      throw new Error(`FlowAggregator: invalid amount ${amount} (${context})`);
    }
  }

  private getOrCreate(year: number): YearlyFlowSummary {
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      throw new Error(`FlowAggregator: invalid year ${year}`);
    }
    let summary = this.years.get(year);
    if (!summary) {
      summary = createEmptySummary();
      this.years.set(year, summary);
    }
    return summary;
  }

  recordIncome(year: number, name: string, amount: number): void {
    this.validateAmount(amount, 'recordIncome');
    const s = this.getOrCreate(year);
    s.income[name] = (s.income[name] || 0) + amount;
    s.totalIncome += amount;
  }

  recordExpense(year: number, category: string, amount: number): void {
    this.validateAmount(amount, 'recordExpense');
    const s = this.getOrCreate(year);
    s.expenses.bills[category] = (s.expenses.bills[category] || 0) + amount;
    s.totalExpenses += amount;
  }

  recordTax(year: number, federal: number, penalty: number): void {
    this.validateAmount(federal, 'recordTax federal');
    this.validateAmount(penalty, 'recordTax penalty');
    const s = this.getOrCreate(year);
    // Subtract old values before overwriting to keep totalExpenses consistent
    s.totalExpenses -= (s.expenses.taxes.federal + s.expenses.taxes.penalty);
    s.expenses.taxes.federal = federal;
    s.expenses.taxes.penalty = penalty;
    s.totalExpenses += federal + penalty;
  }

  recordHealthcare(year: number, type: HealthcareType, amount: number): void {
    this.validateAmount(amount, `recordHealthcare ${type}`);
    const s = this.getOrCreate(year);
    if (type === 'hsaReimbursements') {
      // Store as negative; caller passes positive reimbursement amount
      s.expenses.healthcare[type] += -amount;
      s.totalExpenses -= amount;
    } else {
      s.expenses.healthcare[type] += amount;
      s.totalExpenses += amount;
    }
  }

  recordTransfer(year: number, type: TransferType, amount: number): void {
    this.validateAmount(amount, `recordTransfer ${type}`);
    const s = this.getOrCreate(year);
    s.transfers[type] += amount;
  }

  recordInterest(year: number, amount: number): void {
    this.validateAmount(amount, 'recordInterest');
    const s = this.getOrCreate(year);
    s.totalInterestEarned += amount;
  }

  setStartingBalance(year: number, balance: number): void {
    this.validateAmount(balance, 'setStartingBalance');
    const s = this.getOrCreate(year);
    s.startingBalance = balance;
  }

  setEndingBalance(year: number, balance: number): void {
    this.validateAmount(balance, 'setEndingBalance');
    const s = this.getOrCreate(year);
    s.endingBalance = balance;
  }

  getYearlyFlows(): Record<string, YearlyFlowSummary> {
    const result: Record<string, YearlyFlowSummary> = {};
    for (const [year, summary] of this.years) {
      result[String(year)] = {
        ...summary,
        income: { ...summary.income },
        transfers: { ...summary.transfers },
        expenses: {
          bills: { ...summary.expenses.bills },
          taxes: { ...summary.expenses.taxes },
          healthcare: { ...summary.expenses.healthcare },
        },
        netCashFlow: summary.totalIncome - summary.totalExpenses,
      };
    }
    return result;
  }
}
