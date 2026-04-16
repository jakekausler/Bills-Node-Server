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
    taxes: {
      federalIncome: number;      // Federal income tax on ordinary income
      stateIncome: number;        // State income tax (NC)
      capitalGains: number;       // Long-term capital gains tax
      niit: number;               // Net Investment Income Tax (3.8%)
      fica: number;               // Social Security (6.2%) + Medicare base (1.45%)
      additionalMedicare: number; // Additional 0.9% Medicare on high earners
      penalty: number;            // Early withdrawal penalty
    };
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

export interface TaxBreakdown {
  federalIncome?: number;
  stateIncome?: number;
  capitalGains?: number;
  niit?: number;
  fica?: number;
  additionalMedicare?: number;
  penalty?: number;
}

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
      taxes: {
        federalIncome: 0,
        stateIncome: 0,
        capitalGains: 0,
        niit: 0,
        fica: 0,
        additionalMedicare: 0,
        penalty: 0,
      },
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

  recordTax(year: number, breakdown: TaxBreakdown): void {
    const s = this.getOrCreate(year);

    // Compute old total before accumulating
    const oldTotal = s.expenses.taxes.federalIncome + s.expenses.taxes.stateIncome
      + s.expenses.taxes.capitalGains + s.expenses.taxes.niit + s.expenses.taxes.fica
      + s.expenses.taxes.additionalMedicare + s.expenses.taxes.penalty;

    // Validate provided fields
    for (const [key, value] of Object.entries(breakdown)) {
      if (value !== undefined) this.validateAmount(value, `recordTax ${key}`);
    }

    // Accumulate (additive semantics)
    s.expenses.taxes.federalIncome += breakdown.federalIncome ?? 0;
    s.expenses.taxes.stateIncome += breakdown.stateIncome ?? 0;
    s.expenses.taxes.capitalGains += breakdown.capitalGains ?? 0;
    s.expenses.taxes.niit += breakdown.niit ?? 0;
    s.expenses.taxes.fica += breakdown.fica ?? 0;
    s.expenses.taxes.additionalMedicare += breakdown.additionalMedicare ?? 0;
    s.expenses.taxes.penalty += breakdown.penalty ?? 0;

    const newTotal = s.expenses.taxes.federalIncome + s.expenses.taxes.stateIncome
      + s.expenses.taxes.capitalGains + s.expenses.taxes.niit + s.expenses.taxes.fica
      + s.expenses.taxes.additionalMedicare + s.expenses.taxes.penalty;

    s.totalExpenses += (newTotal - oldTotal);
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

  getYearSummary(year: number): YearlyFlowSummary | undefined {
    const summary = this.years.get(year);
    if (!summary) return undefined;
    return {
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
