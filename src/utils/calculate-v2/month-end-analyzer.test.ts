import { describe, it, expect, beforeEach } from 'vitest';
import { MonthEndAnalyzer } from './month-end-analyzer.js';
import { Account } from '../../data/account/account.js';

describe('MonthEndAnalyzer', () => {
  let analyzer: MonthEndAnalyzer;
  let testAccount: Account;
  let checkingAccount: Account;
  let savingsAccount: Account;
  
  beforeEach(() => {
    analyzer = new MonthEndAnalyzer();
    
    // Create test accounts
    testAccount = new Account({
      id: 'test-account',
      name: 'Test Account',
      todayBalance: 5000,
      performsPulls: true,
      performsPushes: true,
      minimumBalance: 1000,
      pullPriority: 3,
      pushAccount: 'checking'
    } as any);
    
    checkingAccount = new Account({
      id: 'checking',
      name: 'Checking Account',
      pullPriority: 1
    } as any);
    
    savingsAccount = new Account({
      id: 'savings',
      name: 'Savings Account',
      pullPriority: 2
    } as any);
  });

  describe('analyzeMonth', () => {
    it('should track daily balances throughout the month', () => {
      const monthStart = new Date('2025-01-01');
      const monthEnd = new Date('2025-01-31');
      
      // Record some balance changes
      analyzer.recordBalance('test-account', monthStart, 5000);
      analyzer.recordBalance('test-account', new Date('2025-01-10'), 3000);
      analyzer.recordBalance('test-account', new Date('2025-01-20'), 8000);
      analyzer.recordBalance('test-account', new Date('2025-01-31'), 4000);
      
      const analysis = analyzer.analyzeMonth(testAccount, monthStart, monthEnd);
      
      expect(analysis.accountId).toBe('test-account');
      expect(analysis.month).toEqual(monthStart);
      expect(analysis.minimumBalance).toBe(3000);
      expect(analysis.minimumBalanceDate).toEqual(new Date('2025-01-10'));
      expect(analysis.maximumBalance).toBe(8000);
      expect(analysis.maximumBalanceDate).toEqual(new Date('2025-01-20'));
      expect(analysis.dailyBalances.size).toBeGreaterThan(0);
    });

    it('should detect minimum balance violations', () => {
      const monthStart = new Date('2025-01-01');
      const monthEnd = new Date('2025-01-31');
      
      // Set balance below minimum for all days
      const currentDate = new Date(monthStart);
      while (currentDate <= monthEnd) {
        analyzer.recordBalance('test-account', new Date(currentDate), 500);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      const analysis = analyzer.analyzeMonth(testAccount, monthStart, monthEnd);
      
      expect(analysis.violations).toHaveLength(31); // Every day violates
      expect(analysis.violations[0]).toEqual({
        type: 'minimum',
        date: monthStart,
        actualBalance: 500,
        requiredBalance: 1000,
        shortfall: 500
      });
    });

    it('should handle accounts without violations', () => {
      const monthStart = new Date('2025-01-01');
      const monthEnd = new Date('2025-01-31');
      
      // Set balance well within range
      const currentDate = new Date(monthStart);
      while (currentDate <= monthEnd) {
        analyzer.recordBalance('test-account', new Date(currentDate), 5000);
        currentDate.setDate(currentDate.getDate() + 1);
      }
      
      const analysis = analyzer.analyzeMonth(testAccount, monthStart, monthEnd);
      
      expect(analysis.violations).toHaveLength(0);
      expect(analysis.minimumBalance).toBe(5000);
      expect(analysis.maximumBalance).toBe(5000);
    });
  });

  describe('determineRequiredTransfers', () => {
    it('should create pull transfer for minimum balance violation', () => {
      const analysis = {
        accountId: 'test-account',
        month: new Date('2025-01-01'),
        minimumBalance: 500,
        minimumBalanceDate: new Date('2025-01-15'),
        maximumBalance: 500,
        maximumBalanceDate: new Date('2025-01-15'),
        dailyBalances: new Map(),
        violations: [{
          type: 'minimum' as const,
          date: new Date('2025-01-15'),
          actualBalance: 500,
          requiredBalance: 1000,
          shortfall: 500
        }]
      };
      
      const transfers = analyzer.determineRequiredTransfers(
        analysis,
        testAccount,
        [testAccount, checkingAccount, savingsAccount]
      );
      
      expect(transfers).toHaveLength(1);
      expect(transfers[0]).toEqual({
        type: 'pull',
        fromAccount: checkingAccount,
        toAccount: testAccount,
        amount: 500,
        insertDate: analysis.month,
        reason: 'Pull to maintain minimum balance of 1000'
      });
    });

    it('should return empty array when no pull accounts available', () => {
      const analysis = {
        accountId: 'test-account',
        month: new Date('2025-01-01'),
        minimumBalance: 500,
        minimumBalanceDate: new Date('2025-01-15'),
        maximumBalance: 500,
        maximumBalanceDate: new Date('2025-01-15'),
        dailyBalances: new Map(),
        violations: [{
          type: 'minimum' as const,
          date: new Date('2025-01-15'),
          actualBalance: 500,
          requiredBalance: 1000,
          shortfall: 500
        }]
      };
      
      // Create accounts with negative pull priority (can't pull from them)
      const emptyAccounts = [new Account({
        id: 'empty1',
        name: 'Empty Account 1',
        pullPriority: -1
      } as any)];
      
      const transfers = analyzer.determineRequiredTransfers(
        analysis,
        testAccount,
        [testAccount, ...emptyAccounts]
      );
      
      expect(transfers).toHaveLength(0);
    });

    it('should handle multiple violations and use maximum shortfall', () => {
      const analysis = {
        accountId: 'test-account',
        month: new Date('2025-01-01'),
        minimumBalance: 200,
        minimumBalanceDate: new Date('2025-01-20'),
        maximumBalance: 900,
        maximumBalanceDate: new Date('2025-01-05'),
        dailyBalances: new Map(),
        violations: [
          {
            type: 'minimum' as const,
            date: new Date('2025-01-10'),
            actualBalance: 500,
            requiredBalance: 1000,
            shortfall: 500
          },
          {
            type: 'minimum' as const,
            date: new Date('2025-01-20'),
            actualBalance: 200,
            requiredBalance: 1000,
            shortfall: 800
          }
        ]
      };
      
      const transfers = analyzer.determineRequiredTransfers(
        analysis,
        testAccount,
        [testAccount, checkingAccount, savingsAccount]
      );
      
      expect(transfers).toHaveLength(1);
      expect(transfers[0].amount).toBe(800); // Uses maximum shortfall
    });

    it('should return empty array if no violations', () => {
      const analysis = {
        accountId: 'test-account',
        month: new Date('2025-01-01'),
        minimumBalance: 5000,
        minimumBalanceDate: new Date('2025-01-15'),
        maximumBalance: 5000,
        maximumBalanceDate: new Date('2025-01-15'),
        dailyBalances: new Map(),
        violations: []
      };
      
      const transfers = analyzer.determineRequiredTransfers(
        analysis,
        testAccount,
        [testAccount, checkingAccount, savingsAccount]
      );
      
      expect(transfers).toHaveLength(0);
    });

    it('should return empty array if account is not managed', () => {
      const unmanagedAccount = new Account({
        id: 'unmanaged',
        name: 'Unmanaged Account',
        todayBalance: 100,
        performsPulls: false,
        performsPushes: false
      } as any);
      
      const analysis = {
        accountId: 'unmanaged',
        month: new Date('2025-01-01'),
        minimumBalance: 100,
        minimumBalanceDate: new Date('2025-01-15'),
        maximumBalance: 100,
        maximumBalanceDate: new Date('2025-01-15'),
        dailyBalances: new Map(),
        violations: [{
          type: 'minimum' as const,
          date: new Date('2025-01-15'),
          actualBalance: 100,
          requiredBalance: 1000,
          shortfall: 900
        }]
      };
      
      const transfers = analyzer.determineRequiredTransfers(
        analysis,
        unmanagedAccount,
        [unmanagedAccount, checkingAccount, savingsAccount]
      );
      
      expect(transfers).toHaveLength(0);
    });
  });
});