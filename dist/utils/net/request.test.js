import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getData, getSelectedSimulations } from './request';
import { loadData } from '../io/accountsAndTransfers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';
// Mock dependencies
vi.mock('../io/accountsAndTransfers');
vi.mock('../io/retirement');
const mockLoadData = vi.mocked(loadData);
const mockLoadPensionsAndSocialSecurity = vi.mocked(loadPensionsAndSocialSecurity);
const mockAccountsData = {
    accounts: [],
    transfers: { activity: [], bills: [] }
};
const mockRetirementData = {
    socialSecurities: [],
    pensions: []
};
describe('Request Utility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockLoadData.mockReturnValue(mockAccountsData);
        mockLoadPensionsAndSocialSecurity.mockReturnValue(mockRetirementData);
    });
    describe('getSelectedSimulations', () => {
        it('should return default simulations when query param is not provided', () => {
            const mockRequest = {
                query: {}
            };
            const defaultSimulations = ['Default', 'Conservative'];
            const result = getSelectedSimulations(mockRequest, defaultSimulations);
            expect(result).toEqual(['Default', 'Conservative']);
        });
        it('should parse comma-separated simulations from query param', () => {
            const mockRequest = {
                query: {
                    selectedSimulations: 'Aggressive,Conservative,Default'
                }
            };
            const defaultSimulations = ['Default'];
            const result = getSelectedSimulations(mockRequest, defaultSimulations);
            expect(result).toEqual(['Aggressive', 'Conservative', 'Default']);
        });
        it('should handle single simulation in query param', () => {
            const mockRequest = {
                query: {
                    selectedSimulations: 'Custom'
                }
            };
            const defaultSimulations = ['Default'];
            const result = getSelectedSimulations(mockRequest, defaultSimulations);
            expect(result).toEqual(['Custom']);
        });
    });
    describe('getData', () => {
        it('should return complete request data with defaults', () => {
            const mockRequest = {
                query: {},
                body: '{"test": "value"}'
            };
            const result = getData(mockRequest);
            expect(result).toMatchObject({
                simulation: 'Default',
                selectedAccounts: [],
                selectedSimulations: [],
                isTransfer: false,
                skip: false,
                asActivity: false,
                accountsAndTransfers: mockAccountsData,
                socialSecurities: [],
                pensions: [],
                data: { test: 'value' }
            });
            expect(result.startDate).toBeInstanceOf(Date);
            expect(result.endDate).toBeInstanceOf(Date);
        });
        it('should parse query parameters correctly', () => {
            const mockRequest = {
                query: {
                    simulation: 'TestSim',
                    startDate: '2023-01-01',
                    endDate: '2023-12-31',
                    selectedAccounts: 'acc1,acc2,acc3',
                    selectedSimulations: 'sim1,sim2',
                    isTransfer: 'true',
                    asActivity: 'false',
                    skip: 'true',
                    path: 'root.level.deep'
                },
                body: 'raw data'
            };
            const result = getData(mockRequest);
            expect(result.simulation).toBe('TestSim');
            expect(result.selectedAccounts).toEqual(['acc1', 'acc2', 'acc3']);
            expect(result.selectedSimulations).toEqual(['sim1', 'sim2']);
            expect(result.isTransfer).toBe(true);
            expect(result.asActivity).toBe(false);
            expect(result.skip).toBe(true);
            expect(result.path).toEqual(['root', 'level', 'deep']);
            expect(result.data).toBe('raw data');
        });
        it('should handle boolean string variations', () => {
            const mockRequest = {
                query: {
                    isTransfer: 'TRUE',
                    asActivity: 'False',
                    skip: 'false'
                },
                body: ''
            };
            const result = getData(mockRequest);
            expect(result.isTransfer).toBe(true);
            expect(result.asActivity).toBe(false);
            expect(result.skip).toBe(false);
        });
        it('should parse JSON body when valid', () => {
            const mockRequest = {
                query: {},
                body: '{"amount": 100, "description": "test transaction"}'
            };
            const result = getData(mockRequest);
            expect(result.data).toEqual({
                amount: 100,
                description: 'test transaction'
            });
        });
        it('should handle non-JSON body gracefully', () => {
            const mockRequest = {
                query: {},
                body: 'invalid json {'
            };
            const result = getData(mockRequest);
            expect(result.data).toBe('invalid json {');
        });
        it('should use custom defaults when provided', () => {
            const mockRequest = {
                query: {},
                body: ''
            };
            const customDefaults = {
                defaultSimulation: 'CustomSim',
                defaultStartDate: new Date('2022-01-01'),
                defaultEndDate: new Date('2022-12-31'),
                defaultSelectedAccounts: ['default-account'],
                defaultSelectedSimulations: ['default-sim'],
                defaultIsTransfer: true,
                defaultAsActivity: true,
                defaultSkip: true,
                defaultPath: ['custom', 'path']
            };
            const result = getData(mockRequest, customDefaults);
            expect(result.simulation).toBe('CustomSim');
            expect(result.selectedAccounts).toEqual(['default-account']);
            expect(result.isTransfer).toBe(true);
            expect(result.asActivity).toBe(true);
            expect(result.skip).toBe(true);
            expect(result.path).toEqual(['custom', 'path']);
        });
        it('should call loadData and loadPensionsAndSocialSecurity with correct parameters', () => {
            const mockRequest = {
                query: {
                    simulation: 'TestSim',
                    startDate: '2023-01-01',
                    endDate: '2023-12-31'
                },
                body: ''
            };
            const options = {
                updateCache: true,
                overrideStartDateForCalculations: new Date('2022-01-01')
            };
            getData(mockRequest, undefined, options);
            expect(mockLoadData).toHaveBeenCalledWith(new Date('2022-01-01'), // overrideStartDateForCalculations
            expect.any(Date), // endDate
            'TestSim', true // updateCache
            );
            expect(mockLoadPensionsAndSocialSecurity).toHaveBeenCalledWith('TestSim');
        });
    });
});
