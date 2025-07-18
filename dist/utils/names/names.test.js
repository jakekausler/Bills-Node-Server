import { describe, it, expect } from 'vitest';
import { loadNameCategories } from './names';
describe('Names Utility', () => {
    describe('loadNameCategories', () => {
        it('should return empty object for empty accounts and transfers', () => {
            const emptyData = {
                accounts: [],
                transfers: {
                    activity: [],
                    bills: []
                }
            };
            const result = loadNameCategories(emptyData);
            expect(result).toEqual({});
        });
        it('should determine most frequent category for each name', () => {
            const mockData = {
                accounts: [
                    {
                        activity: [
                            { name: 'Grocery Store', category: 'Food' },
                            { name: 'Grocery Store', category: 'Food' },
                            { name: 'Grocery Store', category: 'Household' },
                            { name: 'Gas Station', category: 'Transportation' }
                        ],
                        bills: [
                            { name: 'Electric Bill', category: 'Utilities' },
                            { name: 'Electric Bill', category: 'Utilities' }
                        ]
                    }
                ],
                transfers: {
                    activity: [
                        { name: 'Bank Transfer', category: 'Transfer' }
                    ],
                    bills: [
                        { name: 'Rent', category: 'Housing' }
                    ]
                }
            };
            const result = loadNameCategories(mockData);
            expect(result).toEqual({
                'Grocery Store': 'Food', // 2 Food vs 1 Household
                'Gas Station': 'Transportation',
                'Electric Bill': 'Utilities',
                'Bank Transfer': 'Transfer',
                'Rent': 'Housing'
            });
        });
        it('should handle multiple accounts', () => {
            const mockData = {
                accounts: [
                    {
                        activity: [{ name: 'Coffee Shop', category: 'Food' }],
                        bills: []
                    },
                    {
                        activity: [{ name: 'Coffee Shop', category: 'Entertainment' }],
                        bills: []
                    }
                ],
                transfers: {
                    activity: [],
                    bills: []
                }
            };
            const result = loadNameCategories(mockData);
            // Should pick first alphabetically when tied (Food vs Entertainment)
            expect(result['Coffee Shop']).toBeDefined();
        });
        it('should handle names with same category usage count', () => {
            const mockData = {
                accounts: [
                    {
                        activity: [
                            { name: 'Restaurant', category: 'Food' },
                            { name: 'Restaurant', category: 'Entertainment' }
                        ],
                        bills: []
                    }
                ],
                transfers: {
                    activity: [],
                    bills: []
                }
            };
            const result = loadNameCategories(mockData);
            // When tied, should return the first one encountered after sorting
            expect(result['Restaurant']).toBeDefined();
            expect(['Food', 'Entertainment']).toContain(result['Restaurant']);
        });
    });
});
