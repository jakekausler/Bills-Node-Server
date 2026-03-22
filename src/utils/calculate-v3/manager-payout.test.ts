import { describe, it, expect } from 'vitest';
import { createPayoutActivity } from './manager-payout';

describe('createPayoutActivity', () => {
  it('creates a properly-formed ConsolidatedActivity', () => {
    const activity = createPayoutActivity(
      'test-id',
      '2050-01-01',
      'Test Payout',
      100000,
      'Income.Test',
    );
    expect(activity.id).toBe('test-id');
    expect(activity.amount).toBe(100000);
    expect(activity.name).toBe('Test Payout');
    expect(activity.category).toBe('Income.Test');
    expect(activity.isTransfer).toBe(false);
  });

  it('sets healthcare and paycheck fields to defaults', () => {
    const activity = createPayoutActivity(
      'test-id-2',
      '2050-06-15',
      'Insurance Payout',
      250000,
      'Income.LifeInsurance',
    );
    expect(activity.isHealthcare).toBe(false);
    expect(activity.healthcarePerson).toBeNull();
    expect(activity.paycheckDetails).toBeNull();
    expect(activity.isPaycheckActivity).toBe(false);
  });

  it('sets consolidated-specific fields to defaults', () => {
    const activity = createPayoutActivity(
      'test-id-3',
      '2050-01-01',
      'Inheritance',
      500000,
      'Income.Inheritance',
    );
    expect(activity.billId).toBeNull();
    expect(activity.firstBill).toBe(false);
    expect(activity.interestId).toBeNull();
    expect(activity.firstInterest).toBe(false);
    expect(activity.balance).toBe(0);
  });
});
