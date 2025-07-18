import { describe, it, expect } from 'vitest';
import { getMoneyMovement, getMoneyMovementChartData } from './movement';
describe('Money Movement Utility', () => {
    describe('getMoneyMovement', () => {
        it('should return empty movement for empty accounts', () => {
            const emptyData = {
                accounts: [],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z');
            const result = getMoneyMovement(emptyData, startDate, endDate);
            expect(result).toEqual({
                2023: {}
            });
        });
        it('should calculate movement across multiple years', () => {
            const mockData = {
                accounts: [
                    {
                        name: 'Checking',
                        consolidatedActivity: [
                            { date: new Date('2023-06-15T12:00:00Z'), amount: 1000 },
                            { date: new Date('2024-03-10T12:00:00Z'), amount: -500 }
                        ]
                    },
                    {
                        name: 'Savings',
                        consolidatedActivity: [
                            { date: new Date('2023-12-25T12:00:00Z'), amount: 2000 }
                        ]
                    }
                ],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2024-12-31T23:59:59Z');
            const result = getMoneyMovement(mockData, startDate, endDate);
            expect(result).toEqual({
                2023: {
                    'Checking': 1000,
                    'Savings': 2000
                },
                2024: {
                    'Checking': -500,
                    'Savings': 0
                }
            });
        });
        it('should handle single year range', () => {
            const mockData = {
                accounts: [
                    {
                        name: 'Account1',
                        consolidatedActivity: [
                            { date: new Date('2023-01-15T12:00:00Z'), amount: 100 },
                            { date: new Date('2023-06-15T12:00:00Z'), amount: 200 }
                        ]
                    }
                ],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z');
            const result = getMoneyMovement(mockData, startDate, endDate);
            expect(result).toEqual({
                2023: {
                    'Account1': 300
                }
            });
        });
        it('should initialize years with zero amounts for all accounts', () => {
            const mockData = {
                accounts: [
                    {
                        name: 'Account1',
                        consolidatedActivity: []
                    },
                    {
                        name: 'Account2',
                        consolidatedActivity: []
                    }
                ],
                transfers: { activity: [], bills: [] }
            };
            const startDate = new Date('2023-01-01T00:00:00Z');
            const endDate = new Date('2023-12-31T23:59:59Z');
            const result = getMoneyMovement(mockData, startDate, endDate);
            expect(result).toEqual({
                2023: {
                    'Account1': 0,
                    'Account2': 0
                }
            });
        });
    });
    describe('getMoneyMovementChartData', () => {
        it('should convert movement data to chart format', () => {
            const movement = {
                2023: {
                    'Checking': 1000,
                    'Savings': 2000
                },
                2024: {
                    'Checking': -500,
                    'Savings': 1500
                }
            };
            const result = getMoneyMovementChartData(movement);
            expect(result).toEqual({
                labels: ['2023', '2024'],
                datasets: [
                    {
                        label: 'Checking',
                        data: [1000, -500]
                    },
                    {
                        label: 'Savings',
                        data: [2000, 1500]
                    }
                ]
            });
        });
        it('should handle single year data', () => {
            const movement = {
                2023: {
                    'Account1': 1000
                }
            };
            const result = getMoneyMovementChartData(movement);
            expect(result).toEqual({
                labels: ['2023'],
                datasets: [
                    {
                        label: 'Account1',
                        data: [1000]
                    }
                ]
            });
        });
        it('should handle empty movement data', () => {
            const movement = {
                2023: {}
            };
            const result = getMoneyMovementChartData(movement);
            expect(result).toEqual({
                labels: ['2023'],
                datasets: []
            });
        });
    });
});
