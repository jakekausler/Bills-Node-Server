import { describe, it, expect } from 'vitest';
import { loadNameCategories } from './names';
import { AccountsAndTransfers } from '../../data/account/types';

describe('Names Utility', () => {
  describe('loadNameCategories', () => {
    it('should return empty object for empty accounts and transfers', () => {
      const emptyData: AccountsAndTransfers = {
        accounts: [],
        transfers: {
          activity: [],
          bills: [],
        },
      };

      const result = loadNameCategories(emptyData);
      expect(result).toEqual({});
    });

    it('should track metadata from most recent usage for each name', () => {
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

      // Should return metadata from most recent usage
      expect(result['Grocery Store'].category).toBe('Household'); // Most recent (2026-03-01)
      expect(result['Gas Station'].category).toBe('Transportation');
      expect(result['Electric Bill'].category).toBe('Utilities'); // Most recent (2026-02-01)
      expect(result['Bank Transfer'].category).toBe('Transfer');
      expect(result['Rent'].category).toBe('Housing');
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

      // Should pick most recent (Entertainment on 2026-03-01)
      expect(result['Coffee Shop'].category).toBe('Entertainment');
    });

    it('should pick most recent when multiple categories for same name', () => {
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
                spendingCategory: null,
              },
              {
                name: 'Restaurant',
                category: 'Entertainment',
                date: new Date('2026-02-01'),
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

      // Should pick most recent (Entertainment on 2026-02-01)
      expect(result['Restaurant'].category).toBe('Entertainment');
    });
  });
});
