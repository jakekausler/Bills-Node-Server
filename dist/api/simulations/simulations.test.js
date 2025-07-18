import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSimulations, updateSimulations } from './simulations';
import { getData } from '../../utils/net/request';
import { loadSimulations, saveSimulations } from '../../utils/io/simulation';
import { formatDate } from '../../utils/date/date';
// Mock the dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/io/simulation');
vi.mock('../../utils/date/date');
const mockGetData = vi.mocked(getData);
const mockLoadSimulations = vi.mocked(loadSimulations);
const mockSaveSimulations = vi.mocked(saveSimulations);
const mockFormatDate = vi.mocked(formatDate);
describe('Simulations API', () => {
    const mockRequest = {};
    beforeEach(() => {
        vi.clearAllMocks();
        mockFormatDate.mockImplementation((date) => date.toISOString().split('T')[0]);
    });
    describe('getSimulations', () => {
        it('should return formatted simulations with date values formatted', () => {
            const mockSimulations = [
                {
                    name: 'Base Scenario',
                    enabled: true,
                    selected: true,
                    variables: {
                        retirementDate: {
                            value: new Date('2030-01-01'),
                            type: 'date'
                        },
                        initialBalance: {
                            value: 100000,
                            type: 'number'
                        },
                        riskProfile: {
                            value: 'conservative',
                            type: 'string'
                        }
                    }
                },
                {
                    name: 'Optimistic Scenario',
                    enabled: true,
                    selected: false,
                    variables: {
                        retirementDate: {
                            value: new Date('2025-01-01'),
                            type: 'date'
                        },
                        initialBalance: {
                            value: 150000,
                            type: 'number'
                        }
                    }
                }
            ];
            mockLoadSimulations.mockReturnValue(mockSimulations);
            mockFormatDate.mockReturnValueOnce('2030-01-01').mockReturnValueOnce('2025-01-01');
            const result = getSimulations(mockRequest);
            expect(result).toEqual([
                {
                    name: 'Base Scenario',
                    enabled: true,
                    selected: true,
                    variables: {
                        retirementDate: {
                            value: '2030-01-01',
                            type: 'date'
                        },
                        initialBalance: {
                            value: 100000,
                            type: 'number'
                        },
                        riskProfile: {
                            value: 'conservative',
                            type: 'string'
                        }
                    }
                },
                {
                    name: 'Optimistic Scenario',
                    enabled: true,
                    selected: false,
                    variables: {
                        retirementDate: {
                            value: '2025-01-01',
                            type: 'date'
                        },
                        initialBalance: {
                            value: 150000,
                            type: 'number'
                        }
                    }
                }
            ]);
            expect(mockLoadSimulations).toHaveBeenCalledOnce();
            expect(mockFormatDate).toHaveBeenCalledTimes(2);
        });
        it('should handle simulations with no variables', () => {
            const mockSimulations = [
                {
                    name: 'Empty Scenario',
                    enabled: false,
                    selected: false,
                    variables: {}
                }
            ];
            mockLoadSimulations.mockReturnValue(mockSimulations);
            const result = getSimulations(mockRequest);
            expect(result).toEqual([
                {
                    name: 'Empty Scenario',
                    enabled: false,
                    selected: false,
                    variables: {}
                }
            ]);
            expect(mockLoadSimulations).toHaveBeenCalledOnce();
        });
        it('should handle simulations with only non-date variables', () => {
            const mockSimulations = [
                {
                    name: 'Numbers Only',
                    enabled: true,
                    selected: true,
                    variables: {
                        salary: {
                            value: 80000,
                            type: 'number'
                        },
                        taxRate: {
                            value: 0.25,
                            type: 'number'
                        },
                        category: {
                            value: 'high-earner',
                            type: 'string'
                        }
                    }
                }
            ];
            mockLoadSimulations.mockReturnValue(mockSimulations);
            const result = getSimulations(mockRequest);
            expect(result).toEqual([
                {
                    name: 'Numbers Only',
                    enabled: true,
                    selected: true,
                    variables: {
                        salary: {
                            value: 80000,
                            type: 'number'
                        },
                        taxRate: {
                            value: 0.25,
                            type: 'number'
                        },
                        category: {
                            value: 'high-earner',
                            type: 'string'
                        }
                    }
                }
            ]);
            expect(mockFormatDate).not.toHaveBeenCalled();
        });
        it('should handle empty simulations array', () => {
            mockLoadSimulations.mockReturnValue([]);
            const result = getSimulations(mockRequest);
            expect(result).toEqual([]);
            expect(mockLoadSimulations).toHaveBeenCalledOnce();
        });
        it('should handle mixed variable types correctly', () => {
            const mockSimulations = [
                {
                    name: 'Mixed Types',
                    enabled: true,
                    selected: false,
                    variables: {
                        startDate: {
                            value: new Date('2024-01-01'),
                            type: 'date'
                        },
                        endDate: {
                            value: new Date('2024-12-31'),
                            type: 'date'
                        },
                        amount: {
                            value: 1000,
                            type: 'number'
                        },
                        description: {
                            value: 'test scenario',
                            type: 'string'
                        },
                        isActive: {
                            value: true,
                            type: 'boolean'
                        }
                    }
                }
            ];
            mockLoadSimulations.mockReturnValue(mockSimulations);
            mockFormatDate.mockReturnValueOnce('2024-01-01').mockReturnValueOnce('2024-12-31');
            const result = getSimulations(mockRequest);
            expect(result[0].variables).toEqual({
                startDate: {
                    value: '2024-01-01',
                    type: 'date'
                },
                endDate: {
                    value: '2024-12-31',
                    type: 'date'
                },
                amount: {
                    value: 1000,
                    type: 'number'
                },
                description: {
                    value: 'test scenario',
                    type: 'string'
                },
                isActive: {
                    value: true,
                    type: 'boolean'
                }
            });
            expect(mockFormatDate).toHaveBeenCalledTimes(2);
        });
    });
    describe('updateSimulations', () => {
        it('should save simulations data and return it', () => {
            const mockSimulationsData = [
                {
                    name: 'Updated Scenario',
                    enabled: true,
                    selected: true,
                    variables: {
                        retirementDate: {
                            value: new Date('2030-01-01'),
                            type: 'date'
                        },
                        initialBalance: {
                            value: 200000,
                            type: 'number'
                        }
                    }
                }
            ];
            mockGetData.mockReturnValue({ data: mockSimulationsData });
            const result = updateSimulations(mockRequest);
            expect(result).toEqual(mockSimulationsData);
            expect(mockSaveSimulations).toHaveBeenCalledWith(mockSimulationsData);
            expect(mockGetData).toHaveBeenCalledWith(mockRequest);
        });
        it('should handle empty simulations array', () => {
            const mockSimulationsData = [];
            mockGetData.mockReturnValue({ data: mockSimulationsData });
            const result = updateSimulations(mockRequest);
            expect(result).toEqual([]);
            expect(mockSaveSimulations).toHaveBeenCalledWith([]);
        });
        it('should handle multiple simulations with different configurations', () => {
            const mockSimulationsData = [
                {
                    name: 'Conservative',
                    enabled: true,
                    selected: true,
                    variables: {
                        riskTolerance: {
                            value: 'low',
                            type: 'string'
                        },
                        expectedReturn: {
                            value: 0.05,
                            type: 'number'
                        }
                    }
                },
                {
                    name: 'Aggressive',
                    enabled: true,
                    selected: false,
                    variables: {
                        riskTolerance: {
                            value: 'high',
                            type: 'string'
                        },
                        expectedReturn: {
                            value: 0.12,
                            type: 'number'
                        }
                    }
                },
                {
                    name: 'Disabled Scenario',
                    enabled: false,
                    selected: false,
                    variables: {}
                }
            ];
            mockGetData.mockReturnValue({ data: mockSimulationsData });
            const result = updateSimulations(mockRequest);
            expect(result).toEqual(mockSimulationsData);
            expect(mockSaveSimulations).toHaveBeenCalledWith(mockSimulationsData);
        });
        it('should handle simulations with complex variable structures', () => {
            const mockSimulationsData = [
                {
                    name: 'Complex Scenario',
                    enabled: true,
                    selected: true,
                    variables: {
                        startDate: {
                            value: new Date('2024-01-01'),
                            type: 'date'
                        },
                        endDate: {
                            value: new Date('2029-12-31'),
                            type: 'date'
                        },
                        portfolioValue: {
                            value: 500000,
                            type: 'number'
                        },
                        inflationRate: {
                            value: 0.03,
                            type: 'number'
                        },
                        strategy: {
                            value: 'balanced',
                            type: 'string'
                        },
                        rebalanceAnnually: {
                            value: true,
                            type: 'boolean'
                        }
                    }
                }
            ];
            mockGetData.mockReturnValue({ data: mockSimulationsData });
            const result = updateSimulations(mockRequest);
            expect(result).toEqual(mockSimulationsData);
            expect(mockSaveSimulations).toHaveBeenCalledWith(mockSimulationsData);
        });
    });
});
