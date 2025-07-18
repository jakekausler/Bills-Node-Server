import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSimpleAccounts, addAccount, updateAccounts } from './accounts';
// Mock dependencies
vi.mock('../../utils/io/accountsAndTransfers', () => ({
    saveData: vi.fn(),
}));
vi.mock('../../utils/net/request', () => ({
    getData: vi.fn(),
}));
vi.mock('../../data/account/account', () => ({
    Account: vi.fn().mockImplementation((data) => ({
        id: data.id || 'mock-id',
        name: data.name,
        type: data.type,
        hidden: data.hidden || false,
        pullPriority: data.pullPriority || -1,
        interestTaxRate: data.interestTaxRate || 0,
        withdrawalTaxRate: data.withdrawalTaxRate || 0,
        earlyWithdrawlPenalty: data.earlyWithdrawlPenalty || 0,
        earlyWithdrawlDate: data.earlyWithdrawlDate || null,
        interestPayAccount: data.interestPayAccount || null,
        usesRMD: data.usesRMD || false,
        accountOwnerDOB: data.accountOwnerDOB || null,
        rmdAccount: data.rmdAccount || null,
        minimumBalance: data.minimumBalance || null,
        minimumPullAmount: data.minimumPullAmount || null,
        performsPulls: data.performsPulls || false,
        performsPushes: data.performsPushes || false,
        pushStart: data.pushStart || null,
        pushEnd: data.pushEnd || null,
        pushAccount: data.pushAccount || null,
        simpleAccount: vi.fn().mockReturnValue({
            id: data.id || 'mock-id',
            name: data.name,
            balance: 0,
        }),
    })),
}));
vi.mock('../../utils/date/date', () => ({
    parseDate: vi.fn((date) => date ? new Date(date) : null),
}));
import { saveData } from '../../utils/io/accountsAndTransfers';
import { getData } from '../../utils/net/request';
import { Account } from '../../data/account/account';
describe('Accounts API', () => {
    const mockRequest = {};
    beforeEach(() => {
        vi.clearAllMocks();
    });
    describe('getSimpleAccounts', () => {
        it('should return simplified account data', () => {
            const mockAccounts = [
                { simpleAccount: vi.fn().mockReturnValue({ id: '1', name: 'Account 1', balance: 100 }) },
                { simpleAccount: vi.fn().mockReturnValue({ id: '2', name: 'Account 2', balance: 200 }) },
            ];
            vi.mocked(getData).mockReturnValue({
                accountsAndTransfers: { accounts: mockAccounts, transfers: { bills: [], activity: [] } },
            });
            const result = getSimpleAccounts(mockRequest);
            expect(result).toEqual([
                { id: '1', name: 'Account 1', balance: 100 },
                { id: '2', name: 'Account 2', balance: 200 },
            ]);
            expect(mockAccounts[0].simpleAccount).toHaveBeenCalled();
            expect(mockAccounts[1].simpleAccount).toHaveBeenCalled();
        });
    });
    describe('addAccount', () => {
        it('should add a new account and return its ID', () => {
            const mockAccountData = {
                id: 'new-account',
                name: 'New Account',
                type: 'checking',
                interests: [],
                activity: [],
                bills: [],
                hidden: false,
            };
            const mockAccountsAndTransfers = {
                accounts: [],
                transfers: { bills: [], activity: [] }
            };
            vi.mocked(getData).mockReturnValue({
                data: mockAccountData,
                simulation: 'Default',
                accountsAndTransfers: mockAccountsAndTransfers,
            });
            const result = addAccount(mockRequest);
            expect(Account).toHaveBeenCalledWith(mockAccountData, 'Default');
            expect(mockAccountsAndTransfers.accounts).toHaveLength(1);
            expect(saveData).toHaveBeenCalledWith(mockAccountsAndTransfers);
            expect(result).toBe('new-account');
        });
    });
    describe('updateAccounts', () => {
        it('should update existing accounts with new data', () => {
            const existingAccount = {
                id: 'account-1',
                name: 'Old Name',
                type: 'checking',
                hidden: false,
                pullPriority: 1,
                interestTaxRate: 0.1,
                withdrawalTaxRate: 0.2,
                earlyWithdrawlPenalty: 0.05,
                earlyWithdrawlDate: null,
                interestPayAccount: null,
                usesRMD: false,
                accountOwnerDOB: null,
                rmdAccount: null,
                minimumBalance: 100,
                minimumPullAmount: 50,
                performsPulls: true,
                performsPushes: false,
                pushStart: null,
                pushEnd: null,
                pushAccount: null,
            };
            const newAccountData = {
                id: 'account-1',
                name: 'New Name',
                type: 'savings',
                hidden: true,
                pullPriority: 2,
                interestTaxRate: 0.15,
                withdrawalTaxRate: 0.25,
                earlyWithdrawlPenalty: 0.1,
                interests: [],
                activity: [],
                bills: [],
            };
            const mockAccountsAndTransfers = {
                accounts: [existingAccount],
            };
            vi.mocked(getData).mockReturnValue({
                data: [newAccountData],
                accountsAndTransfers: mockAccountsAndTransfers,
            });
            const result = updateAccounts(mockRequest);
            expect(existingAccount.name).toBe('New Name');
            expect(existingAccount.type).toBe('savings');
            expect(existingAccount.hidden).toBe(true);
            expect(existingAccount.pullPriority).toBe(2);
            expect(existingAccount.interestTaxRate).toBe(0.15);
            expect(existingAccount.withdrawalTaxRate).toBe(0.25);
            expect(existingAccount.earlyWithdrawlPenalty).toBe(0.1);
            expect(saveData).toHaveBeenCalledWith(mockAccountsAndTransfers);
            expect(result).toBe(mockAccountsAndTransfers.accounts);
        });
        it('should handle accounts not found in update data', () => {
            const existingAccount = {
                id: 'account-1',
                name: 'Original Name',
                type: 'checking',
            };
            const mockAccountsAndTransfers = {
                accounts: [existingAccount],
            };
            vi.mocked(getData).mockReturnValue({
                data: [], // No update data
                accountsAndTransfers: mockAccountsAndTransfers,
            });
            const result = updateAccounts(mockRequest);
            // Account should remain unchanged
            expect(existingAccount.name).toBe('Original Name');
            expect(existingAccount.type).toBe('checking');
            expect(saveData).toHaveBeenCalledWith(mockAccountsAndTransfers);
            expect(result).toBe(mockAccountsAndTransfers.accounts);
        });
        it('should handle default values for undefined properties', () => {
            const existingAccount = {
                id: 'account-1',
                name: 'Test Account',
                type: 'checking',
                pullPriority: 5,
                interestTaxRate: 0.3,
                withdrawalTaxRate: 0.4,
                earlyWithdrawlPenalty: 0.2,
                usesRMD: true,
                performsPulls: true,
                performsPushes: true,
            };
            const newAccountData = {
                id: 'account-1',
                name: 'Test Account',
                type: 'checking',
                hidden: false,
                interests: [],
                activity: [],
                bills: [],
                // These are undefined, should use defaults
                pullPriority: undefined,
                interestTaxRate: undefined,
                withdrawalTaxRate: undefined,
                earlyWithdrawlPenalty: undefined,
                usesRMD: undefined,
                performsPulls: undefined,
                performsPushes: undefined,
            };
            const mockAccountsAndTransfers = {
                accounts: [existingAccount],
            };
            vi.mocked(getData).mockReturnValue({
                data: [newAccountData],
                accountsAndTransfers: mockAccountsAndTransfers,
            });
            updateAccounts(mockRequest);
            expect(existingAccount.pullPriority).toBe(-1);
            expect(existingAccount.interestTaxRate).toBe(0);
            expect(existingAccount.withdrawalTaxRate).toBe(0);
            expect(existingAccount.earlyWithdrawlPenalty).toBe(0);
            expect(existingAccount.usesRMD).toBe(false);
            expect(existingAccount.performsPulls).toBe(false);
            expect(existingAccount.performsPushes).toBe(false);
        });
    });
});
