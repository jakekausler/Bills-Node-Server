import { describe, it, expect } from 'vitest';
import { createConsolidatedActivity } from './consolidated-activity-factory';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';

describe('Consolidated Activity Factory', () => {
  describe('createConsolidatedActivity', () => {
    it('should create a ConsolidatedActivity instance from plain data', () => {
      const data = {
        id: 'activity-1',
        name: 'Grocery Store',
        amount: -150.50,
        date: '2024-01-15',
        category: 'Food.Groceries',
        balance: 1000,
        billId: null,
        firstBill: false,
        interestId: null,
        firstInterest: false,
        spendingTrackerId: null,
        firstSpendingTracker: false,
      };

      const result = createConsolidatedActivity(data);

      expect(result).toBeInstanceOf(ConsolidatedActivity);
      expect(result.id).toBe('activity-1');
      expect(result.name).toBe('Grocery Store');
      expect(result.amount).toBe(-150.50);
    });

    it('should preserve bill metadata in creation', () => {
      const data = {
        id: 'bill-activity-1',
        name: 'Rent Payment',
        amount: -2000,
        date: '2024-01-01',
        category: 'Housing.Rent',
        balance: 3000,
        billId: 'bill-123',
        firstBill: true,
        interestId: null,
        firstInterest: false,
        spendingTrackerId: null,
        firstSpendingTracker: false,
      };

      const result = createConsolidatedActivity(data);

      expect(result).toBeInstanceOf(ConsolidatedActivity);
      expect(result.billId).toBe('bill-123');
      expect(result.firstBill).toBe(true);
    });

    it('should preserve interest metadata in creation', () => {
      const data = {
        id: 'interest-activity-1',
        name: 'Monthly Interest',
        amount: 25.50,
        date: '2024-01-31',
        category: 'Income.Interest',
        balance: 5025.50,
        billId: null,
        firstBill: false,
        interestId: 'interest-456',
        firstInterest: true,
        spendingTrackerId: null,
        firstSpendingTracker: false,
      };

      const result = createConsolidatedActivity(data);

      expect(result).toBeInstanceOf(ConsolidatedActivity);
      expect(result.interestId).toBe('interest-456');
      expect(result.firstInterest).toBe(true);
    });

    it('should preserve spending tracker metadata in creation', () => {
      const data = {
        id: 'tracker-activity-1',
        name: 'Healthcare Spending',
        amount: -500,
        date: '2024-02-15',
        category: 'Healthcare.Medical',
        balance: 4500,
        billId: null,
        firstBill: false,
        interestId: null,
        firstInterest: false,
        spendingTrackerId: 'tracker-789',
        firstSpendingTracker: true,
      };

      const result = createConsolidatedActivity(data);

      expect(result).toBeInstanceOf(ConsolidatedActivity);
      expect(result.spendingTrackerId).toBe('tracker-789');
      expect(result.firstSpendingTracker).toBe(true);
    });

    it('should handle activity with all metadata types null', () => {
      const data = {
        id: 'simple-activity-1',
        name: 'Coffee Shop',
        amount: -5.75,
        date: '2024-03-10',
        category: 'Food.Dining',
        balance: 995.25,
        billId: null,
        firstBill: false,
        interestId: null,
        firstInterest: false,
        spendingTrackerId: null,
        firstSpendingTracker: false,
      };

      const result = createConsolidatedActivity(data);

      expect(result).toBeInstanceOf(ConsolidatedActivity);
      expect(result.billId).toBeNull();
      expect(result.interestId).toBeNull();
      expect(result.spendingTrackerId).toBeNull();
    });
  });
});
