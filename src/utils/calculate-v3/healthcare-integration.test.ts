import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Engine } from './engine';
import { Account } from '../../data/account/account';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { HealthcareConfig } from '../../data/healthcare/types';
import { saveHealthcareConfigs } from '../io/healthcareConfigs';

// Mock healthcareConfigs module to prevent writing to real files during tests
let mockConfigs: HealthcareConfig[] = [];

vi.mock('../io/healthcareConfigs', () => ({
  saveHealthcareConfigs: vi.fn((configs: HealthcareConfig[]) => {
    mockConfigs = configs;
    return Promise.resolve();
  }),
  loadHealthcareConfigs: vi.fn(() => Promise.resolve(mockConfigs)),
}));

describe('Healthcare Integration Tests', () => {
  let engine: Engine;

  const hsaAccount: Account = new Account({
    id: 'hsa-account',
    name: 'HSA',
    type: 'HSA',
    balance: 2000,
    interests: [],
    activity: [
      {
        id: 'hsa-initial-deposit',
        name: 'Initial HSA Deposit',
        amount: 2000,
        amountIsVariable: false,
        amountVariable: null,
        date: '2024-01-01',
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        category: 'Income',
        flag: false,
      },
    ],
    bills: [],
    hidden: false,
    pullPriority: 0,
    defaultShowInGraph: false,
  });

  const checkingAccount: Account = new Account({
    id: 'checking-account',
    name: 'Checking',
    type: 'Checking',
    balance: 5000,
    interests: [],
    activity: [
      {
        id: 'checking-initial-deposit',
        name: 'Initial Checking Deposit',
        amount: 5000,
        amountIsVariable: false,
        amountVariable: null,
        date: '2024-01-01',
        dateIsVariable: false,
        dateVariable: null,
        from: null,
        to: null,
        category: 'Income',
        flag: false,
      },
    ],
    bills: [],
    hidden: false,
    pullPriority: 0,
    defaultShowInGraph: false,
  });

  const healthcareConfig: HealthcareConfig = {
    id: 'test-config',
    name: 'Test Plan',
    personName: 'John',
    startDate: '2024-01-01',
    endDate: null,
    individualDeductible: 1500,
    individualOutOfPocketMax: 5000,
    familyDeductible: 3000,
    familyOutOfPocketMax: 10000,
    hsaAccountId: 'hsa-account',
    hsaReimbursementEnabled: true,
    resetMonth: 0,
    resetDay: 1,
  };

  beforeEach(async () => {
    engine = new Engine('Default', {}, false);
    await saveHealthcareConfigs([healthcareConfig]);
  });

  it('should calculate patient cost before deductible met', async () => {
    const healthcareBill: Bill = new Bill({
      id: 'healthcare-bill-1',
      name: 'Doctor Visit',
      category: 'Healthcare',
      amount: 200,
      amountIsVariable: false,
      amountVariable: null,
      startDate: '2024-06-15',
      startDateIsVariable: false,
      startDateVariable: null,
      endDate: null,
      endDateIsVariable: false,
      endDateVariable: null,
      everyN: 1,
      periods: 'month',
      increaseBy: 0,
      increaseByIsVariable: false,
      increaseByVariable: null,
      increaseByDate: '01/01',
      ceilingMultiple: 0,
      monteCarloSampleType: null,
      annualStartDate: null,
      annualEndDate: null,
      isAutomatic: false,
      isTransfer: false,
      from: null,
      to: null,
      flag: false,
      flagColor: null,
      isHealthcare: true,
      healthcarePerson: 'John',
      copayAmount: null,
      coinsurancePercent: 20,
      countsTowardDeductible: true,
      countsTowardOutOfPocket: true,
    });

    checkingAccount.bills.push(healthcareBill);

    const result = await engine.calculate(
      { accounts: [hsaAccount, checkingAccount], transfers: { activity: [], bills: [] } },
      {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        simulation: 'Default',
        monteCarlo: false,
        simulationNumber: 1,
        totalSimulations: 1,
        forceRecalculation: true,
        enableLogging: false,
        config: {},
      },
    );

    // Find the healthcare expense in checking account
    const checkingResult = result.accounts.find((a) => a.id === 'checking-account');
    const healthcareExpense = checkingResult?.consolidatedActivity.find(
      (a) => a.name === 'Doctor Visit' && a.amount === -200,
    );

    expect(healthcareExpense).toBeDefined();
    expect(healthcareExpense?.amount).toBe(-200); // Patient pays 100% before deductible

    // Find the HSA reimbursement
    const hsaResult = result.accounts.find((a) => a.id === 'hsa-account');
    const reimbursement = hsaResult?.consolidatedActivity.find((a) => a.name === 'HSA Reimbursement');

    expect(reimbursement).toBeDefined();
    expect(reimbursement?.amount).toBe(-200); // HSA reimburses full amount
  });

  it('should handle partial HSA reimbursement when insufficient funds', async () => {
    // Create HSA with only $50
    const lowHsaAccount: Account = new Account({
      ...hsaAccount.serialize(),
      balance: 50,
      activity: [
        {
          id: 'hsa-initial-deposit-low',
          name: 'Initial HSA Deposit',
          amount: 50,
          amountIsVariable: false,
          amountVariable: null,
          date: '2024-01-01',
          dateIsVariable: false,
          dateVariable: null,
          from: null,
          to: null,
          category: 'Income',
          flag: false,
        },
      ],
    });

    const healthcareBill: Bill = new Bill({
      id: 'healthcare-bill-2',
      name: 'Prescription',
      category: 'Healthcare',
      amount: 200,
      amountIsVariable: false,
      amountVariable: null,
      startDate: '2024-06-15',
      startDateIsVariable: false,
      startDateVariable: null,
      endDate: null,
      endDateIsVariable: false,
      endDateVariable: null,
      everyN: 1,
      periods: 'month',
      increaseBy: 0,
      increaseByIsVariable: false,
      increaseByVariable: null,
      increaseByDate: '01/01',
      ceilingMultiple: 0,
      monteCarloSampleType: null,
      annualStartDate: null,
      annualEndDate: null,
      isAutomatic: false,
      isTransfer: false,
      from: null,
      to: null,
      flag: false,
      flagColor: null,
      isHealthcare: true,
      healthcarePerson: 'John',
      copayAmount: null,
      coinsurancePercent: 20,
      countsTowardDeductible: true,
      countsTowardOutOfPocket: true,
    });

    checkingAccount.bills.push(healthcareBill);

    const result = await engine.calculate(
      { accounts: [lowHsaAccount, checkingAccount], transfers: { activity: [], bills: [] } },
      {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        simulation: 'Default',
        monteCarlo: false,
        simulationNumber: 1,
        totalSimulations: 1,
        forceRecalculation: true,
        enableLogging: false,
        config: {},
      },
    );

    // Find the HSA reimbursement
    const hsaResult = result.accounts.find((a) => a.id === 'hsa-account');
    const reimbursement = hsaResult?.consolidatedActivity.find((a) => a.name === 'HSA Reimbursement');

    expect(reimbursement).toBeDefined();
    expect(reimbursement?.amount).toBe(-50); // HSA only reimburses what's available
  });

  it('should use copay when specified', async () => {
    const copayBill: Bill = new Bill({
      id: 'healthcare-bill-3',
      name: 'Specialist Visit',
      category: 'Healthcare',
      amount: 300,
      amountIsVariable: false,
      amountVariable: null,
      startDate: '2024-06-15',
      startDateIsVariable: false,
      startDateVariable: null,
      endDate: null,
      endDateIsVariable: false,
      endDateVariable: null,
      everyN: 1,
      periods: 'month',
      increaseBy: 0,
      increaseByIsVariable: false,
      increaseByVariable: null,
      increaseByDate: '01/01',
      ceilingMultiple: 0,
      monteCarloSampleType: null,
      annualStartDate: null,
      annualEndDate: null,
      isAutomatic: false,
      isTransfer: false,
      from: null,
      to: null,
      flag: false,
      flagColor: null,
      isHealthcare: true,
      healthcarePerson: 'John',
      copayAmount: 50,
      coinsurancePercent: null,
      countsTowardDeductible: false,
      countsTowardOutOfPocket: true,
    });

    checkingAccount.bills.push(copayBill);

    const result = await engine.calculate(
      { accounts: [hsaAccount, checkingAccount], transfers: { activity: [], bills: [] } },
      {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
        simulation: 'Default',
        monteCarlo: false,
        simulationNumber: 1,
        totalSimulations: 1,
        forceRecalculation: true,
        enableLogging: false,
        config: {},
      },
    );

    // Find the healthcare expense in checking account
    const checkingResult = result.accounts.find((a) => a.id === 'checking-account');
    const healthcareExpense = checkingResult?.consolidatedActivity.find((a) => a.name === 'Specialist Visit');

    expect(healthcareExpense).toBeDefined();
    expect(healthcareExpense?.amount).toBe(-50); // Patient pays copay only
  });
});
