import { describe, it, expect } from 'vitest';
import { Account, todayBalance } from './account';
describe('Account', () => {
    const mockAccountData = {
        id: 'test-account-1',
        name: 'Test Checking Account',
        interests: [],
        activity: [],
        bills: [],
        hidden: false,
        type: 'checking',
        pullPriority: 1,
        interestTaxRate: 0.25,
        withdrawalTaxRate: 0.20,
        earlyWithdrawlPenalty: 0.10,
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
    describe('constructor', () => {
        it('should create an account with provided data', () => {
            const account = new Account(mockAccountData);
            expect(account.id).toBe('test-account-1');
            expect(account.name).toBe('Test Checking Account');
            expect(account.type).toBe('checking');
            expect(account.hidden).toBe(false);
            expect(account.pullPriority).toBe(1);
            expect(account.interestTaxRate).toBe(0.25);
            expect(account.withdrawalTaxRate).toBe(0.20);
            expect(account.earlyWithdrawlPenalty).toBe(0.10);
            expect(account.usesRMD).toBe(false);
            expect(account.minimumBalance).toBe(100);
            expect(account.minimumPullAmount).toBe(50);
            expect(account.performsPulls).toBe(true);
            expect(account.performsPushes).toBe(false);
        });
        it('should generate UUID when id is not provided', () => {
            const dataWithoutId = { ...mockAccountData };
            delete dataWithoutId.id;
            const account = new Account(dataWithoutId);
            expect(account.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
        });
        it('should set default values for optional fields', () => {
            const minimalData = {
                id: 'test-2',
                name: 'Minimal Account',
                interests: [],
                activity: [],
                bills: [],
                hidden: false,
                type: 'savings',
            };
            const account = new Account(minimalData);
            expect(account.pullPriority).toBe(-1);
            expect(account.interestTaxRate).toBe(0);
            expect(account.withdrawalTaxRate).toBe(0);
            expect(account.earlyWithdrawlPenalty).toBe(0);
            expect(account.earlyWithdrawlDate).toBe(null);
            expect(account.interestPayAccount).toBe(null);
            expect(account.usesRMD).toBe(false);
            expect(account.accountOwnerDOB).toBe(null);
            expect(account.rmdAccount).toBe(null);
            expect(account.minimumBalance).toBe(null);
            expect(account.minimumPullAmount).toBe(null);
            expect(account.performsPulls).toBe(false);
            expect(account.performsPushes).toBe(false);
            expect(account.pushStart).toBe(null);
            expect(account.pushEnd).toBe(null);
            expect(account.pushAccount).toBe(null);
        });
        it('should handle date fields correctly', () => {
            const dataWithDates = {
                ...mockAccountData,
                accountOwnerDOB: '1990-01-01',
                pushStart: '2023-01-01',
                pushEnd: '2023-12-31',
            };
            const account = new Account(dataWithDates);
            expect(account.accountOwnerDOB).toBeInstanceOf(Date);
            expect(account.pushStart).toBeInstanceOf(Date);
            expect(account.pushEnd).toBeInstanceOf(Date);
        });
    });
    describe('serialize', () => {
        it('should serialize account data correctly', () => {
            const account = new Account(mockAccountData);
            const serialized = account.serialize();
            expect(serialized.id).toBe(mockAccountData.id);
            expect(serialized.name).toBe(mockAccountData.name);
            expect(serialized.type).toBe(mockAccountData.type);
            expect(serialized.hidden).toBe(mockAccountData.hidden);
            expect(serialized.pullPriority).toBe(mockAccountData.pullPriority);
            expect(serialized.interestTaxRate).toBe(mockAccountData.interestTaxRate);
            expect(serialized.withdrawalTaxRate).toBe(mockAccountData.withdrawalTaxRate);
            expect(serialized.earlyWithdrawlPenalty).toBe(mockAccountData.earlyWithdrawlPenalty);
            expect(serialized.usesRMD).toBe(mockAccountData.usesRMD);
            expect(serialized.minimumBalance).toBe(mockAccountData.minimumBalance);
            expect(serialized.minimumPullAmount).toBe(mockAccountData.minimumPullAmount);
            expect(serialized.performsPulls).toBe(mockAccountData.performsPulls);
            expect(serialized.performsPushes).toBe(mockAccountData.performsPushes);
        });
        it('should format dates correctly in serialization', () => {
            const dataWithDates = {
                ...mockAccountData,
                accountOwnerDOB: '1990-01-01',
                pushStart: '2023-01-01',
                pushEnd: '2023-12-31',
            };
            const account = new Account(dataWithDates);
            const serialized = account.serialize();
            expect(typeof serialized.accountOwnerDOB).toBe('string');
            expect(typeof serialized.pushStart).toBe('string');
            expect(typeof serialized.pushEnd).toBe('string');
        });
    });
    describe('simpleAccount', () => {
        it('should return simplified account data', () => {
            const account = new Account(mockAccountData);
            account.todayBalance = 1500;
            const simple = account.simpleAccount();
            expect(simple).toEqual({
                id: 'test-account-1',
                name: 'Test Checking Account',
                balance: 1500,
                hidden: false,
                type: 'checking',
                pullPriority: 1,
                interestTaxRate: 0.25,
                withdrawalTaxRate: 0.20,
                earlyWithdrawlPenalty: 0.10,
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
            });
        });
    });
    describe('toString', () => {
        it('should return formatted string representation', () => {
            const account = new Account(mockAccountData);
            const str = account.toString();
            expect(str).toBe('Account(Test Checking Account, test-account-1)');
        });
    });
});
describe('todayBalance', () => {
    const testAccountData = {
        id: 'test-account-1',
        name: 'Test Account',
        interests: [],
        activity: [],
        bills: [],
        hidden: false,
        type: 'checking',
    };
    it('should return 0 when account has no consolidated activity', () => {
        const account = new Account(testAccountData);
        const balance = todayBalance(account);
        expect(balance).toBe(0);
    });
    it('should return balance from most recent activity before today', () => {
        const account = new Account(testAccountData);
        const today = new Date();
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
        // Mock consolidated activity
        account.consolidatedActivity = [
            { date: yesterday, balance: 100 },
            { date: tomorrow, balance: 200 },
        ];
        const balance = todayBalance(account);
        expect(balance).toBe(100);
    });
    it('should return last balance if all activities are in the past', () => {
        const account = new Account(testAccountData);
        const today = new Date();
        const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        account.consolidatedActivity = [
            { date: twoDaysAgo, balance: 50 },
            { date: yesterday, balance: 75 },
        ];
        const balance = todayBalance(account);
        expect(balance).toBe(75);
    });
});
