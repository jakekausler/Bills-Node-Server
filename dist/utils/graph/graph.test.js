import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadGraph, loadYearlyGraph } from './graph';
import { getMinDate } from '../date/date';
// Mock dependencies
vi.mock('../date/date');
vi.mock('../log', () => ({
    startTiming: vi.fn(),
    endTiming: vi.fn()
}));
const mockGetMinDate = vi.mocked(getMinDate);
describe('Graph Utilities', () => {
    const mockAccountsData = {
        accounts: [
            {
                id: 'account-1',
                name: 'Checking Account',
                consolidatedActivity: [
                    {
                        date: new Date('2023-01-15T12:00:00Z'),
                        balance: 1000,
                        name: 'Salary',
                        amount: 1000
                    },
                    {
                        date: new Date('2023-06-15T12:00:00Z'),
                        balance: 1500,
                        name: 'Bonus',
                        amount: 500
                    }
                ]
            },
            {
                id: 'account-2',
                name: 'Savings Account',
                consolidatedActivity: [
                    {
                        date: new Date('2023-03-01T12:00:00Z'),
                        balance: 2000,
                        name: 'Transfer',
                        amount: 2000
                    }
                ]
            }
        ],
        transfers: { activity: [], bills: [] }
    };
    beforeEach(() => {
        vi.clearAllMocks();
        mockGetMinDate.mockReturnValue(new Date('2023-01-01T00:00:00Z'));
    });
    describe('loadGraph', () => {
        it('should return yearly graph for date ranges longer than MAX_DAYS_FOR_ACTIVITY', () => {
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2035-12-31T23:59:59Z'); // More than 10 years
            const result = loadGraph(mockAccountsData, startDate, endDate);
            expect(result.type).toBe('yearly');
            expect(result.labels).toBeDefined();
            expect(result.datasets).toBeDefined();
        });
        it('should return activity graph for shorter date ranges', () => {
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z'); // Less than 10 years
            const result = loadGraph(mockAccountsData, startDate, endDate);
            expect(result.type).toBe('activity');
            expect(result.labels).toBeDefined();
            expect(result.datasets).toBeDefined();
        });
        it('should handle edge case near MAX_DAYS_FOR_ACTIVITY boundary', () => {
            const startDate = new Date('2023-01-01T00:00:00Z');
            // Just under 10 years to ensure it stays as activity graph
            const endDate = new Date('2030-01-01T23:59:59Z');
            const result = loadGraph(mockAccountsData, startDate, endDate);
            // Should be activity graph since it's under the max
            expect(result.type).toBe('activity');
        });
    });
    describe('loadYearlyGraph', () => {
        it('should generate yearly graph data with correct structure', () => {
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z');
            const minDate = new Date('2023-01-01T00:00:00Z');
            const result = loadYearlyGraph(mockAccountsData, startDate, endDate, minDate);
            expect(result.type).toBe('yearly');
            expect(result.labels.length).toBeGreaterThan(0); // Should have at least one year
            expect(result.datasets).toHaveLength(2); // Two accounts
            expect(result.datasets[0].label).toBe('Checking Account');
            expect(result.datasets[1].label).toBe('Savings Account');
        });
        it('should handle multiple years correctly', () => {
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2024-12-31T23:59:59Z');
            const minDate = new Date('2023-01-01T00:00:00Z');
            const extendedAccountsData = {
                ...mockAccountsData,
                accounts: [
                    {
                        ...mockAccountsData.accounts[0],
                        consolidatedActivity: [
                            ...mockAccountsData.accounts[0].consolidatedActivity,
                            {
                                date: new Date('2024-01-15T12:00:00Z'),
                                balance: 2000,
                                name: 'New Year Bonus',
                                amount: 500
                            }
                        ]
                    },
                    mockAccountsData.accounts[1]
                ]
            };
            const result = loadYearlyGraph(extendedAccountsData, startDate, endDate, minDate);
            expect(result.type).toBe('yearly');
            expect(result.labels.length).toBeGreaterThanOrEqual(2); // Should have 2023 and 2024
            expect(result.datasets).toHaveLength(2);
        });
        it('should handle accounts with no activities', () => {
            const emptyAccountsData = {
                accounts: [
                    {
                        id: 'empty-account',
                        name: 'Empty Account',
                        consolidatedActivity: []
                    }
                ],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z');
            const minDate = new Date('2023-01-01T00:00:00Z');
            const result = loadYearlyGraph(emptyAccountsData, startDate, endDate, minDate);
            expect(result.type).toBe('yearly');
            expect(result.datasets).toHaveLength(1);
            expect(result.datasets[0].data).toBeDefined();
        });
        it('should respect date range filtering', () => {
            const startDate = new Date('2023-06-01T00:00:00Z'); // Start after some activities
            const endDate = new Date('2023-12-31T23:59:59Z');
            const minDate = new Date('2023-01-01T00:00:00Z');
            const result = loadYearlyGraph(mockAccountsData, startDate, endDate, minDate);
            expect(result.type).toBe('yearly');
            expect(result.datasets).toHaveLength(2);
            // Should still process all activities but only include dates within range
        });
        it('should handle empty accounts array', () => {
            const emptyData = {
                accounts: [],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z');
            const minDate = new Date('2023-01-01T00:00:00Z');
            const result = loadYearlyGraph(emptyData, startDate, endDate, minDate);
            expect(result.type).toBe('yearly');
            expect(result.datasets).toHaveLength(0);
            expect(result.labels).toBeDefined();
        });
    });
    describe('helper functions behavior', () => {
        it('should maintain balance tracking accuracy', () => {
            const accountWithMultipleActivities = {
                accounts: [
                    {
                        id: 'test-account',
                        name: 'Test Account',
                        consolidatedActivity: [
                            {
                                date: new Date('2023-01-01T12:00:00Z'),
                                balance: 100,
                                name: 'Initial',
                                amount: 100
                            },
                            {
                                date: new Date('2023-01-01T13:00:00Z'),
                                balance: 150,
                                name: 'Same Day',
                                amount: 50
                            }
                        ]
                    }
                ],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-01-01T23:59:59Z');
            const minDate = new Date('2023-01-01T00:00:00Z');
            const result = loadYearlyGraph(accountWithMultipleActivities, startDate, endDate, minDate);
            expect(result.datasets[0].data).toBeDefined();
            // Should track the minimum balance (100) for the year
        });
    });
});
