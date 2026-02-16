import { describe, it, expect, vi } from 'vitest';
import { Calculator } from './calculator';
import { BalanceTracker } from './balance-tracker';
import { TaxManager } from './tax-manager';
import { RetirementManager } from './retirement-manager';
import { HealthcareManager } from './healthcare-manager';
import { AccountManager } from './account-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import { Account } from '../../data/account/account';
import { Bill } from '../../data/bill/bill';
import { BillEvent, CalculationOptions, SegmentResult } from './types';
import { HealthcareConfig } from '../../data/healthcare/types';

vi.mock('../io/retirement', () => ({
  loadPensionsAndSocialSecurity: vi.fn(() => ({
    socialSecurities: [],
    pensions: [],
  })),
}));

describe('HSA Reimbursement', () => {
  const hsaAccountId = 'hsa-account-123';
  const paymentAccountId = 'payment-account-456';

  function createAccounts(hsaBalance: number) {
    const hsaAccount = new Account({
      id: hsaAccountId,
      name: 'Jane HSA',
      type: 'Savings',
      interests: [],
      activity: [{
        id: 'hsa-opening-balance',
        name: 'Opening Balance',
        category: 'Ignore.Balance Adjustment',
        flag: false,
        flagColor: null,
        isTransfer: false,
        from: null,
        to: null,
        amount: hsaBalance,
        amountIsVariable: false,
        amountVariable: null,
        date: '2025-01-01',
        dateIsVariable: false,
        dateVariable: null,
        isHealthcare: false,
        healthcarePerson: null,
        copayAmount: null,
        coinsurancePercent: null,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
      }],
      bills: [],
    });

    const paymentAccount = new Account({
      id: paymentAccountId,
      name: 'Kendall Checking',
      type: 'Checking',
      interests: [],
      activity: [{
        id: 'checking-opening-balance',
        name: 'Opening Balance',
        category: 'Ignore.Balance Adjustment',
        flag: false,
        flagColor: null,
        isTransfer: false,
        from: null,
        to: null,
        amount: 10000,
        amountIsVariable: false,
        amountVariable: null,
        date: '2025-01-01',
        dateIsVariable: false,
        dateVariable: null,
        isHealthcare: false,
        healthcarePerson: null,
        copayAmount: null,
        coinsurancePercent: null,
        countsTowardDeductible: true,
        countsTowardOutOfPocket: true,
      }],
      bills: [],
    });

    return { hsaAccount, paymentAccount };
  }

  async function createCalculator(hsaBalance: number) {
    const { hsaAccount, paymentAccount } = createAccounts(hsaBalance);

    const mockCache = {
      findClosestSnapshot: async () => null,
      setBalanceSnapshot: async () => 'test-snapshot-key',
    } as any;

    const balanceTracker = new BalanceTracker([hsaAccount, paymentAccount], mockCache, new Date('2026-01-01'));
    await balanceTracker.initializeBalances({ accounts: [hsaAccount, paymentAccount], transfers: [] });

    // Manually set initial balances since the balance tracker initializes to 0
    // and opening balance activities are only processed during segment processing
    balanceTracker.updateBalance(hsaAccountId, hsaBalance, new Date('2025-01-01'));
    balanceTracker.updateBalance(paymentAccountId, 10000, new Date('2025-01-01'));

    const healthcareConfigs: HealthcareConfig[] = [{
      id: 'config-123',
      name: 'Jane Health Plan',
      coveredPersons: ['Jane'],
      startDate: '2025-01-01',
      endDate: null,
      individualDeductible: 1500,
      individualOutOfPocketMax: 5000,
      familyDeductible: 3000,
      familyOutOfPocketMax: 10000,
      hsaAccountId: hsaAccountId,
      hsaReimbursementEnabled: true,
      resetMonth: 0,
      resetDay: 1,
    }];

    const healthcareManager = new HealthcareManager(healthcareConfigs);
    const taxManager = new TaxManager();
    const retirementManager = new RetirementManager([], []);
    const calculationOptions: CalculationOptions = {
      startDate: new Date('2025-01-01'),
      endDate: new Date('2026-12-31'),
      simulation: 'primary',
      monteCarlo: false,
      simulationNumber: 1,
      totalSimulations: 1,
      forceRecalculation: true,
      enableLogging: false,
      config: {},
    };
    const accountManager = new AccountManager([hsaAccount, paymentAccount], calculationOptions);
    const spendingTrackerManager = new SpendingTrackerManager([], 'primary', new Date());

    const calculator = new Calculator(
      balanceTracker,
      taxManager,
      retirementManager,
      healthcareManager,
      accountManager,
      'primary',
      spendingTrackerManager,
    );

    const segmentResult: SegmentResult = {
      activitiesAdded: new Map(),
      balanceChanges: new Map(),
      taxableOccurences: new Map(),
      processedEventIds: new Set(),
      balanceMinimums: new Map(),
      balanceMaximums: new Map(),
      spendingTrackerUpdates: [],
    };

    return { calculator, segmentResult };
  }

  function createHealthcareBill(id: string, name: string, amount: number, date: string, copayAmount: number) {
    return new Bill({
      id,
      name,
      category: 'Health.Doctor',
      flag: false,
      flagColor: null,
      isTransfer: false,
      from: null,
      to: null,
      amount,
      amountIsVariable: false,
      amountVariable: null,
      startDate: date,
      startDateIsVariable: false,
      startDateVariable: null,
      endDate: null,
      endDateIsVariable: false,
      endDateVariable: null,
      increaseBy: 0,
      increaseByIsVariable: false,
      increaseByVariable: null,
      increaseByDate: '01/01',
      everyN: 1,
      periods: 'month',
      ceilingMultiple: 0,
      monteCarloSampleType: null,
      annualStartDate: null,
      annualEndDate: null,
      isAutomatic: false,
      isHealthcare: true,
      healthcarePerson: 'Jane',
      copayAmount,
      coinsurancePercent: null,
      countsTowardDeductible: false,
      countsTowardOutOfPocket: true,
    });
  }

  it('should create HSA reimbursement transfer for healthcare bill with copay', async () => {
    const { calculator, segmentResult } = await createCalculator(2000);

    const healthcareBill = createHealthcareBill('bill-123', 'Jane Doctor Visit', -300, '2026-03-15', 100);

    const billEvent: BillEvent = {
      type: 'bill',
      date: new Date('2026-03-15'),
      accountId: paymentAccountId,
      originalBill: healthcareBill,
      amount: -300,
      firstBill: false,
    };

    // Process the healthcare bill
    const balanceChanges = calculator.processBillEvent(billEvent, segmentResult, 'primary');

    // Verify balance changes
    expect(balanceChanges.get(paymentAccountId)).toBe(-100); // Patient cost

    // Verify HSA reimbursement activities were created
    const hsaActivities = segmentResult.activitiesAdded.get(hsaAccountId);
    const paymentActivities = segmentResult.activitiesAdded.get(paymentAccountId);

    expect(hsaActivities).toBeDefined();
    expect(paymentActivities).toBeDefined();
    expect(hsaActivities!.length).toBeGreaterThanOrEqual(1); // At least the HSA withdrawal
    expect(paymentActivities!.length).toBeGreaterThanOrEqual(2); // Healthcare expense + reimbursement deposit

    // Find the HSA reimbursement activities
    const hsaWithdrawal = hsaActivities!.find(a => a.name === 'HSA Reimbursement' && a.amount < 0);
    const reimbursementDeposit = paymentActivities!.find(a => a.name === 'HSA Reimbursement' && a.amount > 0);

    expect(hsaWithdrawal).toBeDefined();
    expect(reimbursementDeposit).toBeDefined();
    expect(hsaWithdrawal!.amount).toBe(-100); // Withdrawing $100 from HSA
    expect(reimbursementDeposit!.amount).toBe(100); // Depositing $100 to payment account
    expect(hsaWithdrawal!.isTransfer).toBe(true);
    expect(reimbursementDeposit!.isTransfer).toBe(true);

    // Verify balance changes include the reimbursement
    expect(segmentResult.balanceChanges.get(hsaAccountId)).toBe(-100);
    expect(segmentResult.balanceChanges.get(paymentAccountId)).toBe(0); // -100 expense + 100 reimbursement = 0
  });

  it('should handle partial reimbursement when HSA balance is insufficient', async () => {
    // HSA has only $50 available
    const { calculator, segmentResult } = await createCalculator(50);

    const healthcareBill = createHealthcareBill('bill-456', 'Jane Expensive Procedure', -500, '2026-04-01', 200);

    const billEvent: BillEvent = {
      type: 'bill',
      date: new Date('2026-04-01'),
      accountId: paymentAccountId,
      originalBill: healthcareBill,
      amount: -500,
      firstBill: false,
    };

    calculator.processBillEvent(billEvent, segmentResult, 'primary');

    // Verify only $50 was reimbursed (partial reimbursement)
    const hsaActivities = segmentResult.activitiesAdded.get(hsaAccountId);
    const hsaWithdrawal = hsaActivities?.find(a => a.name === 'HSA Reimbursement');

    expect(hsaWithdrawal).toBeDefined();
    expect(hsaWithdrawal!.amount).toBe(-50); // Only $50 available in HSA
    expect(segmentResult.balanceChanges.get(hsaAccountId)).toBe(-50);
    expect(segmentResult.balanceChanges.get(paymentAccountId)).toBe(-150); // -200 + 50 = -150
  });

  it('should not create reimbursement when HSA balance is zero', async () => {
    // HSA has $0
    const { calculator, segmentResult } = await createCalculator(0);

    const healthcareBill = createHealthcareBill('bill-789', 'Jane Checkup', -150, '2026-05-01', 50);

    const billEvent: BillEvent = {
      type: 'bill',
      date: new Date('2026-05-01'),
      accountId: paymentAccountId,
      originalBill: healthcareBill,
      amount: -150,
      firstBill: false,
    };

    calculator.processBillEvent(billEvent, segmentResult, 'primary');

    // Verify no HSA reimbursement activities were created
    const hsaActivities = segmentResult.activitiesAdded.get(hsaAccountId);
    expect(hsaActivities).toBeUndefined(); // No activities added to HSA account

    // Only the healthcare expense should be recorded
    expect(segmentResult.balanceChanges.get(paymentAccountId)).toBe(-50);
  });
});
