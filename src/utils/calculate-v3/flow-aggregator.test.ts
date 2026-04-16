import { describe, it, expect, beforeEach } from 'vitest';
import { FlowAggregator } from './flow-aggregator';

describe('FlowAggregator', () => {
  let agg: FlowAggregator;

  beforeEach(() => {
    agg = new FlowAggregator();
  });

  it('recordIncome accumulates by name and year', () => {
    agg.recordIncome(2030, 'Nearpod', 5000);
    agg.recordIncome(2030, 'Nearpod', 5000);
    agg.recordIncome(2030, 'Social Security', 2000);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].income['Nearpod']).toBe(10000);
    expect(flows['2030'].income['Social Security']).toBe(2000);
    expect(flows['2030'].totalIncome).toBe(12000);
  });

  it('recordExpense accumulates by category', () => {
    agg.recordExpense(2030, 'Housing', 1500);
    agg.recordExpense(2030, 'Housing', 1500);
    agg.recordExpense(2030, 'Utilities', 200);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].expenses.bills['Housing']).toBe(3000);
    expect(flows['2030'].expenses.bills['Utilities']).toBe(200);
    expect(flows['2030'].totalExpenses).toBe(3200);
  });

  it('recordTax sets all 7 tax fields correctly', () => {
    agg.recordTax(2030, {
      federalIncome: 15000,
      stateIncome: 1500,
      capitalGains: 2000,
      niit: 500,
      fica: 5000,
      additionalMedicare: 200,
      penalty: 500,
    });

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].expenses.taxes.federalIncome).toBe(15000);
    expect(flows['2030'].expenses.taxes.stateIncome).toBe(1500);
    expect(flows['2030'].expenses.taxes.capitalGains).toBe(2000);
    expect(flows['2030'].expenses.taxes.niit).toBe(500);
    expect(flows['2030'].expenses.taxes.fica).toBe(5000);
    expect(flows['2030'].expenses.taxes.additionalMedicare).toBe(200);
    expect(flows['2030'].expenses.taxes.penalty).toBe(500);
    expect(flows['2030'].totalExpenses).toBe(24700);
  });

  it('recordHealthcare accumulates by type', () => {
    agg.recordHealthcare(2030, 'cobra', 600);
    agg.recordHealthcare(2030, 'cobra', 600);
    agg.recordHealthcare(2030, 'medicare', 170);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].expenses.healthcare.cobra).toBe(1200);
    expect(flows['2030'].expenses.healthcare.medicare).toBe(170);
    expect(flows['2030'].totalExpenses).toBe(1370);
  });

  it('recordTransfer accumulates by type', () => {
    agg.recordTransfer(2030, 'rothConversions', 10000);
    agg.recordTransfer(2030, 'rothConversions', 5000);
    agg.recordTransfer(2030, 'autoPulls', 3000);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].transfers.rothConversions).toBe(15000);
    expect(flows['2030'].transfers.autoPulls).toBe(3000);
  });

  it('recordInterest accumulates', () => {
    agg.recordInterest(2030, 500);
    agg.recordInterest(2030, 300);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].totalInterestEarned).toBe(800);
  });

  it('setStartingBalance and setEndingBalance work', () => {
    agg.setStartingBalance(2030, 100000);
    agg.setEndingBalance(2030, 110000);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].startingBalance).toBe(100000);
    expect(flows['2030'].endingBalance).toBe(110000);
  });

  it('getYearlyFlows computes netCashFlow correctly', () => {
    agg.recordIncome(2030, 'Salary', 80000);
    agg.recordExpense(2030, 'Housing', 24000);
    agg.recordTax(2030, { federalIncome: 10000 });

    const flows = agg.getYearlyFlows();
    // netCashFlow = totalIncome - totalExpenses = 80000 - 34000 = 46000
    expect(flows['2030'].netCashFlow).toBe(46000);
  });

  it('multiple years tracked independently', () => {
    agg.recordIncome(2030, 'Salary', 80000);
    agg.recordIncome(2031, 'Salary', 85000);
    agg.recordExpense(2030, 'Housing', 24000);
    agg.recordExpense(2031, 'Housing', 25000);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].totalIncome).toBe(80000);
    expect(flows['2031'].totalIncome).toBe(85000);
    expect(flows['2030'].totalExpenses).toBe(24000);
    expect(flows['2031'].totalExpenses).toBe(25000);
    expect(flows['2030'].netCashFlow).toBe(56000);
    expect(flows['2031'].netCashFlow).toBe(60000);
  });

  it('hsaReimbursements reduce totalExpenses', () => {
    agg.recordHealthcare(2030, 'outOfPocket', 5000);
    agg.recordHealthcare(2030, 'hsaReimbursements', 2000);

    const flows = agg.getYearlyFlows();
    expect(flows['2030'].expenses.healthcare.outOfPocket).toBe(5000);
    expect(flows['2030'].expenses.healthcare.hsaReimbursements).toBe(-2000);
    // totalExpenses = 5000 (OOP) - 2000 (HSA reimbursement) = 3000
    expect(flows['2030'].totalExpenses).toBe(3000);
  });

  it('returns empty object for new aggregator', () => {
    expect(agg.getYearlyFlows()).toEqual({});
  });

  it('accumulates multiple recordTax calls', () => {
    agg.recordTax(2030, { fica: 5000, penalty: 200 });
    agg.recordTax(2030, { federalIncome: 8000, penalty: 300 });
    const flows = agg.getYearlyFlows();
    expect(flows['2030'].expenses.taxes.fica).toBe(5000);
    expect(flows['2030'].expenses.taxes.federalIncome).toBe(8000);
    expect(flows['2030'].expenses.taxes.penalty).toBe(500); // 200 + 300
    expect(flows['2030'].totalExpenses).toBe(13500); // 5000 + 8000 + 500
  });

  it('handles negative amounts (refunds)', () => {
    agg.recordIncome(2030, 'Refund', -500);
    const flows = agg.getYearlyFlows();
    expect(flows['2030'].income['Refund']).toBe(-500);
    expect(flows['2030'].totalIncome).toBe(-500);
  });

  it('getYearlyFlows returns copies, not references', () => {
    agg.recordIncome(2030, 'Salary', 50000);
    const flows1 = agg.getYearlyFlows();
    flows1['2030'].totalIncome = 0;
    flows1['2030'].income['Salary'] = 0;
    const flows2 = agg.getYearlyFlows();
    expect(flows2['2030'].totalIncome).toBe(50000);
    expect(flows2['2030'].income['Salary']).toBe(50000);
  });

  it('rejects invalid amounts', () => {
    expect(() => agg.recordIncome(2030, 'Bad', NaN)).toThrow('invalid amount');
    expect(() => agg.recordIncome(2030, 'Bad', Infinity)).toThrow('invalid amount');
    expect(() => agg.recordExpense(2030, 'Bad', NaN)).toThrow('invalid amount');
    expect(() => agg.recordTax(2030, { federalIncome: NaN })).toThrow('invalid amount');
    expect(() => agg.recordTax(2030, { penalty: Infinity })).toThrow('invalid amount');
    expect(() => agg.recordTax(2030, { fica: NaN })).toThrow('invalid amount');
    expect(() => agg.recordHealthcare(2030, 'cobra', NaN)).toThrow('invalid amount');
    expect(() => agg.recordTransfer(2030, 'autoPulls', NaN)).toThrow('invalid amount');
    expect(() => agg.recordInterest(2030, NaN)).toThrow('invalid amount');
  });

  it('rejects invalid years', () => {
    expect(() => agg.recordIncome(1899, 'X', 100)).toThrow('invalid year');
    expect(() => agg.recordIncome(2201, 'X', 100)).toThrow('invalid year');
    expect(() => agg.recordIncome(2030.5, 'X', 100)).toThrow('invalid year');
  });
});
