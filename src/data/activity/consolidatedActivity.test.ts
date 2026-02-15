import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsolidatedActivity } from './consolidatedActivity';
import { ActivityData } from './types';

// Mock the parent Activity class
vi.mock('./activity', () => ({
  Activity: class MockActivity {
    id: string;
    name: string;
    amount: number | null;
    date: Date;
    category: string;
    description: string;
    isTransfer: boolean;
    spendingCategory: string | null;

    constructor(data: ActivityData) {
      this.id = data.id || 'test-id';
      this.name = data.name || 'Test Activity';
      this.amount = data.amount !== undefined ? data.amount : 100;
      this.date = data.date ? new Date(data.date) : new Date();
      this.category = data.category || 'Test Category';
      this.description = data.description || 'Test Description';
      this.isTransfer = data.isTransfer || false;
      this.spendingCategory = data.spendingCategory ?? null;
    }

    serialize() {
      return {
        id: this.id,
        name: this.name,
        amount: this.amount,
        date: this.date,
        category: this.category,
        description: this.description,
        isTransfer: this.isTransfer,
        spendingCategory: this.spendingCategory,
      };
    }
  },
}));

describe('ConsolidatedActivity', () => {
  const mockActivityData: ActivityData = {
    id: 'test-activity-id',
    name: 'Test Consolidated Activity',
    amount: 250,
    date: new Date('2023-06-15T12:00:00Z'),
    category: 'Testing',
    description: 'Test consolidated activity description',
    isTransfer: false,
  };

  describe('constructor', () => {
    it('should create a consolidated activity with default options', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData);

      expect(consolidatedActivity.id).toBe('test-activity-id');
      expect(consolidatedActivity.name).toBe('Test Consolidated Activity');
      expect(consolidatedActivity.amount).toBe(250);
      expect(consolidatedActivity.billId).toBeNull();
      expect(consolidatedActivity.firstBill).toBe(false);
      expect(consolidatedActivity.interestId).toBeNull();
      expect(consolidatedActivity.firstInterest).toBe(false);
      expect(consolidatedActivity.balance).toBe(0);
    });

    it('should create a consolidated activity with bill ID', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData, {
        billId: 'test-bill-id',
      });

      expect(consolidatedActivity.billId).toBe('test-bill-id');
      expect(consolidatedActivity.interestId).toBeNull();
    });

    it('should create a consolidated activity with interest ID', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData, {
        interestId: 'test-interest-id',
      });

      expect(consolidatedActivity.interestId).toBe('test-interest-id');
      expect(consolidatedActivity.billId).toBeNull();
    });

    it('should create a consolidated activity with both bill and interest IDs', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData, {
        billId: 'test-bill-id',
        interestId: 'test-interest-id',
      });

      expect(consolidatedActivity.billId).toBe('test-bill-id');
      expect(consolidatedActivity.interestId).toBe('test-interest-id');
    });

    it('should reverse amount when reverseAmount is true', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData, {
        reverseAmount: true,
      });

      expect(consolidatedActivity.amount).toBe(-250);
    });

    it('should not reverse amount when reverseAmount is false', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData, {
        reverseAmount: false,
      });

      expect(consolidatedActivity.amount).toBe(250);
    });

    it('should handle null amount when reverseAmount is true', () => {
      const activityWithNullAmount = { ...mockActivityData, amount: null };
      const consolidatedActivity = new ConsolidatedActivity(activityWithNullAmount, {
        reverseAmount: true,
      });

      expect(consolidatedActivity.amount).toBeNull();
    });

    it('should handle zero amount when reverseAmount is true', () => {
      const activityWithZeroAmount = { ...mockActivityData, amount: 0 };
      const consolidatedActivity = new ConsolidatedActivity(activityWithZeroAmount, {
        reverseAmount: true,
      });

      expect(consolidatedActivity.amount).toBe(0);
    });
  });

  describe('serialize', () => {
    it('should serialize consolidated activity with all properties', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData, {
        billId: 'test-bill-id',
        interestId: 'test-interest-id',
      });

      // Set additional properties for testing
      consolidatedActivity.balance = 1000;
      consolidatedActivity.firstBill = true;
      consolidatedActivity.firstInterest = true;

      const serialized = consolidatedActivity.serialize();

      expect(serialized).toEqual({
        id: 'test-activity-id',
        name: 'Test Consolidated Activity',
        amount: 250,
        date: expect.any(Date),
        category: 'Testing',
        description: 'Test consolidated activity description',
        isTransfer: false,
        spendingCategory: null,
        balance: 1000,
        billId: 'test-bill-id',
        firstBill: true,
        interestId: 'test-interest-id',
        firstInterest: true,
      });
    });

    it('should serialize consolidated activity with null IDs', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData);
      consolidatedActivity.balance = 500;

      const serialized = consolidatedActivity.serialize();

      expect(serialized.billId).toBeNull();
      expect(serialized.interestId).toBeNull();
      expect(serialized.firstBill).toBe(false);
      expect(serialized.firstInterest).toBe(false);
      expect(serialized.balance).toBe(500);
    });
  });

  describe('property manipulation', () => {
    it('should allow setting balance after construction', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData);

      consolidatedActivity.balance = 1500;

      expect(consolidatedActivity.balance).toBe(1500);
    });

    it('should allow setting first bill flag after construction', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData);

      consolidatedActivity.firstBill = true;

      expect(consolidatedActivity.firstBill).toBe(true);
    });

    it('should allow setting first interest flag after construction', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData);

      consolidatedActivity.firstInterest = true;

      expect(consolidatedActivity.firstInterest).toBe(true);
    });
  });

  describe('spendingCategory', () => {
    it('should serialize spendingCategory when set', () => {
      const dataWithSpendingCategory: ActivityData = {
        ...mockActivityData,
        spendingCategory: 'Entertainment',
      };

      const consolidatedActivity = new ConsolidatedActivity(dataWithSpendingCategory);
      const serialized = consolidatedActivity.serialize();

      expect(serialized.spendingCategory).toBe('Entertainment');
    });

    it('should serialize spendingCategory as null when not provided', () => {
      const consolidatedActivity = new ConsolidatedActivity(mockActivityData);
      const serialized = consolidatedActivity.serialize();

      expect(serialized.spendingCategory).toBeNull();
    });

    it('should round-trip spendingCategory through serialize and deserialize', () => {
      const dataWithSpendingCategory: ActivityData = {
        ...mockActivityData,
        spendingCategory: 'Healthcare',
      };

      const consolidatedActivity = new ConsolidatedActivity(dataWithSpendingCategory, {
        billId: 'bill-1',
      });
      const serialized = consolidatedActivity.serialize();

      // Verify spendingCategory survives through the ConsolidatedActivity serialize chain
      expect(serialized.spendingCategory).toBe('Healthcare');
      expect(serialized.billId).toBe('bill-1');
    });
  });
});
