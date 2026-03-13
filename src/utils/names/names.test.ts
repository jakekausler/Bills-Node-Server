import { describe, it, expect } from 'vitest';
import { loadNameCategories } from './names';
import { AccountsAndTransfers } from '../../data/account/types';

describe('Names Utility', () => {
  describe('loadNameCategories', () => {
    it('should return empty array for empty accounts and transfers', () => {
      const emptyData: AccountsAndTransfers = {
        accounts: [],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = loadNameCategories(emptyData);
      expect(result).toEqual([]);
    });

    it('should track metadata from most recent usage for each distinct name+category combination', () => {
      const mockData: AccountsAndTransfers = {
        accounts: [
          {
            activity: [
              {
                name: 'Grocery Store',
                category: 'Food',
                date: new Date('2026-01-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
              {
                name: 'Grocery Store',
                category: 'Food',
                date: new Date('2026-02-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
              {
                name: 'Grocery Store',
                category: 'Household',
                date: new Date('2026-03-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
              {
                name: 'Gas Station',
                category: 'Transportation',
                date: new Date('2026-01-15'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
            ],
            bills: [
              {
                name: 'Electric Bill',
                category: 'Utilities',
                startDate: new Date('2026-01-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
              {
                name: 'Electric Bill',
                category: 'Utilities',
                startDate: new Date('2026-02-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
            ],
          } as any,
        ],
        transfers: {
          activity: [{
            name: 'Bank Transfer',
            category: 'Transfer',
            date: new Date('2026-01-10'),
            isHealthcare: false,
            healthcarePerson: null,
            coinsurancePercent: null,
            isTransfer: false,
            from: null,
            to: null,
            spendingCategory: null,
          }],
          bills: [{
            name: 'Rent',
            category: 'Housing',
            startDate: new Date('2026-01-05'),
            isHealthcare: false,
            healthcarePerson: null,
            coinsurancePercent: null,
            isTransfer: false,
            from: null,
            to: null,
            spendingCategory: null,
          }],
        },
      };

      const result = loadNameCategories(mockData);

      // Should return all distinct name+category combinations
      const findEntry = (name: string, category: string) =>
        result.find(e => e.name === name && e.category === category);

      // Most recent for Grocery Store + Food: 2026-02-01
      expect(findEntry('Grocery Store', 'Food')).toBeDefined();
      expect(findEntry('Grocery Store', 'Food')?.category).toBe('Food');

      // Grocery Store + Household: 2026-03-01
      expect(findEntry('Grocery Store', 'Household')).toBeDefined();
      expect(findEntry('Grocery Store', 'Household')?.category).toBe('Household');

      expect(findEntry('Gas Station', 'Transportation')).toBeDefined();
      expect(findEntry('Gas Station', 'Transportation')?.category).toBe('Transportation');

      expect(findEntry('Electric Bill', 'Utilities')).toBeDefined();
      expect(findEntry('Electric Bill', 'Utilities')?.category).toBe('Utilities');

      expect(findEntry('Bank Transfer', 'Transfer')).toBeDefined();
      expect(findEntry('Bank Transfer', 'Transfer')?.category).toBe('Transfer');

      expect(findEntry('Rent', 'Housing')).toBeDefined();
      expect(findEntry('Rent', 'Housing')?.category).toBe('Housing');

      // Should have exactly 6 entries (one for each distinct name+category combination)
      expect(result.length).toBe(6);
    });

    it('should handle multiple accounts', () => {
      const mockData: AccountsAndTransfers = {
        accounts: [
          {
            activity: [{
              name: 'Coffee Shop',
              category: 'Food',
              date: new Date('2026-01-01'),
              isHealthcare: false,
              healthcarePerson: null,
              coinsurancePercent: null,
              isTransfer: false,
              from: null,
              to: null,
              spendingCategory: null,
            }],
            bills: [],
          } as any,
          {
            activity: [{
              name: 'Coffee Shop',
              category: 'Entertainment',
              date: new Date('2026-03-01'),
              isHealthcare: false,
              healthcarePerson: null,
              coinsurancePercent: null,
              isTransfer: false,
              from: null,
              to: null,
              spendingCategory: null,
            }],
            bills: [],
          } as any,
        ],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = loadNameCategories(mockData);

      // Should have both combinations
      expect(result.length).toBe(2);
      expect(result.find(e => e.name === 'Coffee Shop' && e.category === 'Food')).toBeDefined();
      expect(result.find(e => e.name === 'Coffee Shop' && e.category === 'Entertainment')).toBeDefined();
    });

    it('should pick most recent metadata for same name+category combination', () => {
      const mockData: AccountsAndTransfers = {
        accounts: [
          {
            activity: [
              {
                name: 'Restaurant',
                category: 'Food',
                date: new Date('2026-01-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: 'OldSpending',
              },
              {
                name: 'Restaurant',
                category: 'Food',
                date: new Date('2026-02-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: 'NewSpending',
              },
            ],
            bills: [],
          } as any,
        ],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = loadNameCategories(mockData);

      // Should have one entry with most recent metadata
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Restaurant');
      expect(result[0].category).toBe('Food');
      expect(result[0].spendingCategory).toBe('NewSpending');
    });

    it('should return sorted results by name then category', () => {
      const mockData: AccountsAndTransfers = {
        accounts: [
          {
            activity: [
              {
                name: 'Zebra Store',
                category: 'Food',
                date: new Date('2026-01-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
              {
                name: 'Apple Store',
                category: 'Shopping',
                date: new Date('2026-01-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
              {
                name: 'Apple Store',
                category: 'Entertainment',
                date: new Date('2026-01-01'),
                isHealthcare: false,
                healthcarePerson: null,
                coinsurancePercent: null,
                isTransfer: false,
                from: null,
                to: null,
                spendingCategory: null,
              },
            ],
            bills: [],
          } as any,
        ],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = loadNameCategories(mockData);

      // Should be sorted by name, then category
      expect(result[0].name).toBe('Apple Store');
      expect(result[0].category).toBe('Entertainment');
      expect(result[1].name).toBe('Apple Store');
      expect(result[1].category).toBe('Shopping');
      expect(result[2].name).toBe('Zebra Store');
    });
  });
});
