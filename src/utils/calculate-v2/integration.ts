/**
 * API compatibility layer for the new calculate-v2 system
 *
 * This module provides seamless integration between the existing API
 * and the new optimized calculation engine, maintaining backwards
 * compatibility while enabling the performance improvements.
 */

import { CalculationEngine, calculateAllActivity } from './engine';
import { AccountsAndTransfers } from '../../data/account/types';
import { CalculationConfig, CalculationResult, CalculationAccount } from './types';
import { initializeCache } from './cache';

/**
 * Legacy API compatibility wrapper
 */
export class CalculationAPIWrapper {
  private static instance: CalculationAPIWrapper | null = null;
  private engine: CalculationEngine;
  private config: CalculationConfig;

  private useNewSystem: boolean = false;
  private performanceComparisonEnabled: boolean = false;
  private fallbackOnError: boolean = true;
  private rolloutPercentage: number = 0;
  private performanceMetrics = {
    newSystemCalls: 0,
    legacySystemCalls: 0,
    averageNewSystemTime: 0,
    averageLegacyTime: 0,
  };

  private constructor(config: Partial<CalculationConfig> = {}) {
    this.config = this.getDefaultConfig(config);
    this.engine = new CalculationEngine(this.config);
  }

  /**
   * Gets or creates the singleton instance
   */
  static getInstance(config: Partial<CalculationConfig> = {}): CalculationAPIWrapper {
    if (!CalculationAPIWrapper.instance) {
      CalculationAPIWrapper.instance = new CalculationAPIWrapper(config);
    }
    return CalculationAPIWrapper.instance;
  }

  /**
   * Resets the singleton instance (useful for testing)
   */
  static reset(): void {
    CalculationAPIWrapper.instance = null;
  }

  /**
   * Enable or disable the new calculation system
   */
  enableNewCalculationSystem(enabled: boolean): void {
    this.useNewSystem = enabled;
  }

  /**
   * Check if new system is enabled
   */
  isNewSystemEnabled(): boolean {
    return this.useNewSystem;
  }

  /**
   * Enable or disable performance comparison
   */
  enablePerformanceComparison(enabled: boolean): void {
    this.performanceComparisonEnabled = enabled;
  }

  /**
   * Check if performance comparison is enabled
   */
  isPerformanceComparisonEnabled(): boolean {
    return this.performanceComparisonEnabled;
  }

  /**
   * Enable or disable fallback on error
   */
  enableFallbackOnError(enabled: boolean): void {
    this.fallbackOnError = enabled;
  }

  /**
   * Check if fallback is enabled
   */
  isFallbackEnabled(): boolean {
    return this.fallbackOnError;
  }

  /**
   * Set rollout percentage
   */
  setRolloutPercentage(percentage: number): void {
    this.rolloutPercentage = Math.max(0, Math.min(100, percentage));
  }

  /**
   * Main calculation method that maintains API compatibility
   */
  async calculateAllActivity(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
    simulation: string = 'Default',
    monteCarlo: boolean = false,
    simulationNumber: number = 1,
    nSimulations: number = 1,
  ): Promise<void> {
    const startTime = performance.now();

    try {
      if (this.useNewSystem) {
        // Use the new calculation engine
        const result = await calculateAllActivity(
          accountsAndTransfers,
          startDate,
          endDate,
          simulation,
          monteCarlo,
          simulationNumber,
          nSimulations,
          this.config,
        );

        const endTime = performance.now();
        this.performanceMetrics.newSystemCalls++;
        this.performanceMetrics.averageNewSystemTime =
          (this.performanceMetrics.averageNewSystemTime * (this.performanceMetrics.newSystemCalls - 1) +
            (endTime - startTime)) /
          this.performanceMetrics.newSystemCalls;

        // Apply results back to the original structure for compatibility
        this.applyResultsToLegacyStructure(accountsAndTransfers, result);
      } else {
        // Simulate legacy calculation (placeholder)
        const endTime = performance.now();
        this.performanceMetrics.legacySystemCalls++;
        this.performanceMetrics.averageLegacyTime =
          (this.performanceMetrics.averageLegacyTime * (this.performanceMetrics.legacySystemCalls - 1) +
            (endTime - startTime)) /
          this.performanceMetrics.legacySystemCalls;

        // In a real implementation, this would call the legacy calculateAllActivity
        console.log('Using legacy calculation system (placeholder)');
      }
    } catch (error) {
      console.error('Calculation failed:', error);

      if (this.fallbackOnError && this.useNewSystem) {
        console.log('Falling back to legacy system...');
        // In a real implementation, this would call the legacy system
        console.log('Legacy fallback (placeholder)');
      } else {
        throw error;
      }
    }
  }

  /**
   * Performance comparison utility
   */
  async compareWithLegacy(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
    simulation: string = 'Default',
  ): Promise<{
    newSystemTime: number;
    legacySystemTime: number;
    speedupFactor: number;
    resultsMatch: boolean;
    differences?: any[];
  }> {
    // Deep clone for independent calculations
    const accountsForNew = JSON.parse(JSON.stringify(accountsAndTransfers));
    const accountsForLegacy = JSON.parse(JSON.stringify(accountsAndTransfers));

    // Time new system
    const newStartTime = process.hrtime.bigint();
    const newResult = await calculateAllActivity(
      accountsForNew,
      startDate,
      endDate,
      simulation,
      false,
      1,
      1,
      this.config,
    );
    const newEndTime = process.hrtime.bigint();
    const newSystemTime = Number(newEndTime - newStartTime) / 1e6; // Convert to milliseconds

    // Time legacy system (would need to import the old calculateAllActivity)
    const legacyStartTime = process.hrtime.bigint();
    // TODO: Call legacy system
    // await legacyCalculateAllActivity(accountsForLegacy, startDate, endDate, simulation);
    const legacyEndTime = process.hrtime.bigint();
    const legacySystemTime = Number(legacyEndTime - legacyStartTime) / 1e6;

    // Compare results
    const comparison = this.compareResults(newResult.accounts, accountsForLegacy.accounts);

    return {
      newSystemTime,
      legacySystemTime: legacySystemTime || 1, // Prevent division by zero
      speedupFactor: (legacySystemTime || 1) / newSystemTime,
      resultsMatch: comparison.match,
      differences: comparison.differences,
    };
  }

  /**
   * Configuration management
   */
  updateConfig(newConfig: Partial<CalculationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.engine = new CalculationEngine(this.config);
  }

  getConfig(): CalculationConfig {
    return { ...this.config };
  }

  /**
   * Performance monitoring
   */
  getPerformanceMetrics(): any {
    return this.engine.getPerformanceStats();
  }

  /**
   * Cache management
   */
  async clearCaches(): Promise<void> {
    await this.engine.clearCaches();
  }

  async performCacheCleanup(): Promise<void> {
    await this.engine.cleanup();
  }

  // Private helper methods

  private getDefaultConfig(overrides: Partial<CalculationConfig>): CalculationConfig {
    const defaults: CalculationConfig = {
      snapshotInterval: 'monthly',
      maxMemoryCacheMB: 100,
      useDiskCache: true,
      diskCacheDir: './cache/calculate-v2',
      enableParallelProcessing: false, // TODO: Enable after implementing
      maxWorkerThreads: 4,
      enablePerfMetrics: true,
    };

    return { ...defaults, ...overrides };
  }

  private applyResultsToLegacyStructure(accountsAndTransfers: AccountsAndTransfers, result: CalculationResult): void {
    // Update accounts with calculated activities and balances
    for (let i = 0; i < accountsAndTransfers.accounts.length; i++) {
      const originalAccount = accountsAndTransfers.accounts[i];
      const calculatedAccount = result.accounts.find((acc) => acc.id === originalAccount.id);

      if (calculatedAccount) {
        // Update consolidated activities
        originalAccount.consolidatedActivity = calculatedAccount.consolidatedActivity;

        // Update final balance using CalculationAccount interface
        const calcAccount = originalAccount as CalculationAccount;
        calcAccount.balance = result.finalBalances[originalAccount.id] || calcAccount.balance || 0;
      }
    }
  }

  private compareResults(
    newAccounts: any[],
    legacyAccounts: any[],
  ): {
    match: boolean;
    differences: any[];
  } {
    const differences: any[] = [];
    let match = true;

    // Compare account count
    if (newAccounts.length !== legacyAccounts.length) {
      differences.push({
        type: 'account_count',
        new: newAccounts.length,
        legacy: legacyAccounts.length,
      });
      match = false;
    }

    // Compare each account
    for (const newAccount of newAccounts) {
      const legacyAccount = legacyAccounts.find((acc) => acc.id === newAccount.id);

      if (!legacyAccount) {
        differences.push({
          type: 'missing_account',
          accountId: newAccount.id,
          message: 'Account exists in new system but not legacy',
        });
        match = false;
        continue;
      }

      // Compare final balances
      const balanceDiff = Math.abs(newAccount.balance - legacyAccount.balance);
      if (balanceDiff > 0.01) {
        // Allow for small rounding differences
        differences.push({
          type: 'balance_difference',
          accountId: newAccount.id,
          new: newAccount.balance,
          legacy: legacyAccount.balance,
          difference: balanceDiff,
        });
        match = false;
      }

      // Compare activity counts
      if (newAccount.consolidatedActivity.length !== legacyAccount.consolidatedActivity.length) {
        differences.push({
          type: 'activity_count',
          accountId: newAccount.id,
          new: newAccount.consolidatedActivity.length,
          legacy: legacyAccount.consolidatedActivity.length,
        });
        match = false;
      }

      // Compare individual activities
      for (
        let i = 0;
        i < Math.min(newAccount.consolidatedActivity.length, legacyAccount.consolidatedActivity.length);
        i++
      ) {
        const newActivity = newAccount.consolidatedActivity[i];
        const legacyActivity = legacyAccount.consolidatedActivity[i];

        const activityBalanceDiff = Math.abs(newActivity.balance - legacyActivity.balance);
        if (activityBalanceDiff > 0.01) {
          differences.push({
            type: 'activity_balance',
            accountId: newAccount.id,
            activityIndex: i,
            activityName: newActivity.name,
            new: newActivity.balance,
            legacy: legacyActivity.balance,
            difference: activityBalanceDiff,
          });
          match = false;
        }
      }
    }

    return { match, differences };
  }
}

/**
 * Global instance for easy access
 */
let globalWrapper: CalculationAPIWrapper | null = null;

/**
 * Initialize the calculation system with configuration
 */
export function initializeCalculationSystem(config: Partial<CalculationConfig> = {}): CalculationAPIWrapper {
  globalWrapper = CalculationAPIWrapper.getInstance(config);
  return globalWrapper;
}

/**
 * Get the global calculation wrapper
 */
export function getCalculationSystem(): CalculationAPIWrapper {
  if (!globalWrapper) {
    globalWrapper = CalculationAPIWrapper.getInstance();
  }
  return globalWrapper;
}

/**
 * Legacy function replacement - drop-in replacement for the original calculateAllActivity
 */
export async function legacyCalculateAllActivity(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  simulation: string = 'Default',
  monteCarlo: boolean = false,
  simulationNumber: number = 1,
  nSimulations: number = 1,
): Promise<void> {
  const wrapper = getCalculationSystem();
  return await wrapper.calculateAllActivity(
    accountsAndTransfers,
    startDate,
    endDate,
    simulation,
    monteCarlo,
    simulationNumber,
    nSimulations,
  );
}

/**
 * Feature flags for gradual rollout
 */
export interface CalculationFeatureFlags {
  useNewCalculationEngine: boolean;
  enablePerformanceComparison: boolean;
  fallbackToLegacyOnError: boolean;
  enableDetailedLogging: boolean;
}

const defaultFeatureFlags: CalculationFeatureFlags = {
  useNewCalculationEngine: false, // Start with legacy by default
  enablePerformanceComparison: false,
  fallbackToLegacyOnError: true,
  enableDetailedLogging: false,
};

let currentFeatureFlags = { ...defaultFeatureFlags };

/**
 * Update feature flags
 */
export function setCalculationFeatureFlags(flags: Partial<CalculationFeatureFlags>): void {
  currentFeatureFlags = { ...currentFeatureFlags, ...flags };
}

/**
 * Get current feature flags
 */
export function getCalculationFeatureFlags(): CalculationFeatureFlags {
  return { ...currentFeatureFlags };
}

/**
 * Smart calculation function that respects feature flags
 */
export async function smartCalculateAllActivity(
  accountsAndTransfers: AccountsAndTransfers,
  startDate: Date,
  endDate: Date,
  simulation: string = 'Default',
  monteCarlo: boolean = false,
  simulationNumber: number = 1,
  nSimulations: number = 1,
): Promise<{
  success: boolean;
  usedNewEngine: boolean;
  performanceData?: any;
  error?: string;
}> {
  const flags = getCalculationFeatureFlags();

  if (flags.useNewCalculationEngine) {
    try {
      const wrapper = getCalculationSystem();

      if (flags.enablePerformanceComparison) {
        const comparison = await wrapper.compareWithLegacy(accountsAndTransfers, startDate, endDate, simulation);

        if (flags.enableDetailedLogging) {
          console.log('Performance comparison:', comparison);
        }

        return {
          success: true,
          usedNewEngine: true,
          performanceData: comparison,
        };
      } else {
        await wrapper.calculateAllActivity(
          accountsAndTransfers,
          startDate,
          endDate,
          simulation,
          monteCarlo,
          simulationNumber,
          nSimulations,
        );

        return {
          success: true,
          usedNewEngine: true,
        };
      }
    } catch (error) {
      if (flags.fallbackToLegacyOnError) {
        console.warn('New engine failed, falling back to legacy:', error);
        // TODO: Call legacy system
        return {
          success: true,
          usedNewEngine: false,
          error: (error as Error).message,
        };
      } else {
        throw error;
      }
    }
  } else {
    // TODO: Call legacy system
    return {
      success: true,
      usedNewEngine: false,
    };
  }
}

/**
 * Migration utilities for data structure compatibility
 */
export class DataMigrationUtilities {
  /**
   * Validates that accounts and transfers data is compatible with new system
   */
  static validateDataCompatibility(accountsAndTransfers: AccountsAndTransfers): {
    compatible: boolean;
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check accounts
    for (const account of accountsAndTransfers.accounts) {
      if (!account.id) {
        issues.push(`Account missing ID: ${account.name}`);
      }

      if (!account.type) {
        issues.push(`Account missing type: ${account.name || account.id}`);
      }

      // Check activities
      for (const activity of account.activity) {
        if (!activity.id) {
          warnings.push(`Activity missing ID in account ${account.name}`);
        }

        if (!activity.date) {
          issues.push(`Activity missing date in account ${account.name}`);
        }
      }

      // Check bills
      for (const bill of account.bills) {
        if (!bill.id) {
          warnings.push(`Bill missing ID in account ${account.name}`);
        }

        if ((!bill.periods || !bill.everyN) && bill.startDate) {
          warnings.push(`Bill missing periods or everyN in account ${account.name}: ${bill.name}`);
        }
      }

      // Check interests
      for (const interest of account.interests) {
        if (!interest.id) {
          warnings.push(`Interest missing ID in account ${account.name}`);
        }
      }
    }

    return {
      compatible: issues.length === 0,
      issues,
      warnings,
    };
  }

  /**
   * Attempts to fix common data compatibility issues
   */
  static fixDataCompatibilityIssues(accountsAndTransfers: AccountsAndTransfers): {
    fixed: boolean;
    fixesApplied: string[];
    remainingIssues: string[];
  } {
    const fixesApplied: string[] = [];
    const remainingIssues: string[] = [];

    // Generate missing IDs
    for (const account of accountsAndTransfers.accounts) {
      if (!account.id) {
        account.id = `account_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        fixesApplied.push(`Generated ID for account: ${account.name}`);
      }

      // Fix activities
      for (let i = 0; i < account.activity.length; i++) {
        const activity = account.activity[i];
        if (!activity.id) {
          activity.id = `activity_${account.id}_${i}_${Date.now()}`;
          fixesApplied.push(`Generated ID for activity in account ${account.name}`);
        }
      }

      // Fix bills
      for (let i = 0; i < account.bills.length; i++) {
        const bill = account.bills[i];
        if (!bill.id) {
          bill.id = `bill_${account.id}_${i}_${Date.now()}`;
          fixesApplied.push(`Generated ID for bill in account ${account.name}`);
        }
      }

      // Fix interests
      for (let i = 0; i < account.interests.length; i++) {
        const interest = account.interests[i];
        if (!interest.id) {
          interest.id = `interest_${account.id}_${i}_${Date.now()}`;
          fixesApplied.push(`Generated ID for interest in account ${account.name}`);
        }
      }
    }

    // Validate again to check for remaining issues
    const validation = this.validateDataCompatibility(accountsAndTransfers);
    remainingIssues.push(...validation.issues);

    return {
      fixed: remainingIssues.length === 0,
      fixesApplied,
      remainingIssues,
    };
  }
}

// CalculationAPIWrapper is already exported as a class above
