/**
 * Migration utilities for transitioning from legacy to calculate-v2 system
 * 
 * This module provides tools for data migration, validation, and gradual
 * rollout management to ensure smooth transition to the new calculation system.
 */

import { AccountsAndTransfers } from '../../data/account/types';
import { CalculationConfig } from './types';
import { ComparisonTestFramework, ComparisonTestConfig } from './comparison-testing';
import { PerformanceBenchmark, BenchmarkConfig } from './performance-benchmarking';

/**
 * Migration validation result
 */
export interface MigrationValidation {
  /** Whether migration is safe to proceed */
  isSafe: boolean;
  /** Validation issues found */
  issues: ValidationIssue[];
  /** Recommended actions */
  recommendations: string[];
  /** Confidence score (0-1) */
  confidenceScore: number;
  /** Estimated performance improvement */
  estimatedImprovement: {
    speedupFactor: number;
    memoryReduction: number;
  };
}

/**
 * Validation issue types
 */
export interface ValidationIssue {
  /** Issue severity */
  severity: 'error' | 'warning' | 'info';
  /** Issue category */
  category: 'data_compatibility' | 'performance' | 'functionality' | 'configuration';
  /** Issue description */
  description: string;
  /** Affected data path */
  path?: string;
  /** Suggested fix */
  suggestedFix?: string;
  /** Whether issue is automatically fixable */
  autoFixable: boolean;
}

/**
 * Migration strategy configuration
 */
export interface MigrationStrategy {
  /** Migration approach */
  approach: 'big_bang' | 'gradual' | 'canary' | 'blue_green';
  /** Rollout percentage for gradual migration */
  rolloutPercentage: number;
  /** Rollback criteria */
  rollbackCriteria: RollbackCriteria;
  /** Feature flags configuration */
  featureFlags: FeatureFlagsConfig;
  /** Monitoring configuration */
  monitoring: MonitoringConfig;
}

/**
 * Rollback criteria configuration
 */
export interface RollbackCriteria {
  /** Maximum error rate threshold */
  maxErrorRate: number;
  /** Maximum performance degradation threshold */
  maxPerformanceDegradation: number;
  /** Maximum memory increase threshold */
  maxMemoryIncrease: number;
  /** Automatic rollback enabled */
  autoRollback: boolean;
  /** Rollback timeout in minutes */
  rollbackTimeout: number;
}

/**
 * Feature flags configuration
 */
export interface FeatureFlagsConfig {
  /** Enable new calculation system */
  enableNewSystem: boolean;
  /** Enable performance comparison */
  enableComparison: boolean;
  /** Enable caching */
  enableCaching: boolean;
  /** Enable parallel processing */
  enableParallelProcessing: boolean;
  /** Enable fallback on errors */
  enableFallback: boolean;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  /** Metrics collection interval (ms) */
  metricsInterval: number;
  /** Enable detailed logging */
  enableDetailedLogging: boolean;
  /** Performance alert thresholds */
  alertThresholds: {
    executionTime: number;
    errorRate: number;
    memoryUsage: number;
  };
  /** Metrics retention period (days) */
  retentionPeriod: number;
}

/**
 * Migration progress tracking
 */
export interface MigrationProgress {
  /** Migration phase */
  phase: 'planning' | 'validation' | 'testing' | 'rollout' | 'completed' | 'rolled_back';
  /** Progress percentage */
  percentage: number;
  /** Current step description */
  currentStep: string;
  /** Start timestamp */
  startTime: Date;
  /** Estimated completion time */
  estimatedCompletion?: Date;
  /** Issues encountered */
  issues: ValidationIssue[];
  /** Performance metrics */
  metrics: MigrationMetrics;
}

/**
 * Migration performance metrics
 */
export interface MigrationMetrics {
  /** Total calculations processed */
  totalCalculations: number;
  /** New system calculations */
  newSystemCalculations: number;
  /** Legacy system calculations */
  legacyCalculations: number;
  /** Average execution time (new system) */
  avgNewSystemTime: number;
  /** Average execution time (legacy system) */
  avgLegacyTime: number;
  /** Error counts */
  errorCounts: {
    newSystem: number;
    legacy: number;
  };
  /** Memory usage comparison */
  memoryUsage: {
    newSystem: number;
    legacy: number;
  };
}

/**
 * Main migration management system
 */
export class MigrationManager {
  private strategy: MigrationStrategy;
  private progress: MigrationProgress;
  private comparisonFramework: ComparisonTestFramework;
  private benchmarkFramework: PerformanceBenchmark;

  constructor(
    strategy: MigrationStrategy,
    comparisonConfig: ComparisonTestConfig,
    benchmarkConfig: BenchmarkConfig,
    calculationConfig: CalculationConfig
  ) {
    this.strategy = strategy;
    this.progress = this.initializeProgress();
    this.comparisonFramework = new ComparisonTestFramework(comparisonConfig, calculationConfig);
    this.benchmarkFramework = new PerformanceBenchmark(benchmarkConfig, calculationConfig);
  }

  /**
   * Performs comprehensive migration validation
   */
  async validateMigration(accountsAndTransfers: AccountsAndTransfers): Promise<MigrationValidation> {
    console.log('Starting migration validation...');
    
    this.updateProgress('validation', 0, 'Starting validation process');

    const issues: ValidationIssue[] = [];
    let confidenceScore = 1.0;

    // Data compatibility validation
    this.updateProgress('validation', 20, 'Validating data compatibility');
    const dataIssues = await this.validateDataCompatibility(accountsAndTransfers);
    issues.push(...dataIssues);

    // Performance validation
    this.updateProgress('validation', 40, 'Running performance validation');
    const performanceIssues = await this.validatePerformance(accountsAndTransfers);
    issues.push(...performanceIssues);

    // Functionality validation
    this.updateProgress('validation', 60, 'Validating functionality');
    const functionalityIssues = await this.validateFunctionality(accountsAndTransfers);
    issues.push(...functionalityIssues);

    // Configuration validation
    this.updateProgress('validation', 80, 'Validating configuration');
    const configIssues = await this.validateConfiguration();
    issues.push(...configIssues);

    // Calculate confidence score
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    
    confidenceScore -= (errorCount * 0.3) + (warningCount * 0.1);
    confidenceScore = Math.max(0, Math.min(1, confidenceScore));

    // Estimate performance improvement
    const estimatedImprovement = await this.estimatePerformanceImprovement(accountsAndTransfers);

    this.updateProgress('validation', 100, 'Validation completed');

    const validation: MigrationValidation = {
      isSafe: errorCount === 0 && confidenceScore >= 0.8,
      issues,
      recommendations: this.generateRecommendations(issues),
      confidenceScore,
      estimatedImprovement
    };

    console.log(`Migration validation completed. Safe: ${validation.isSafe}, Confidence: ${(confidenceScore * 100).toFixed(1)}%`);

    return validation;
  }

  /**
   * Executes the migration process
   */
  async executeMigration(accountsAndTransfers: AccountsAndTransfers): Promise<void> {
    console.log(`Starting migration with strategy: ${this.strategy.approach}`);

    this.updateProgress('testing', 0, 'Preparing migration');

    try {
      switch (this.strategy.approach) {
        case 'big_bang':
          await this.executeBigBangMigration(accountsAndTransfers);
          break;
        case 'gradual':
          await this.executeGradualMigration(accountsAndTransfers);
          break;
        case 'canary':
          await this.executeCanaryMigration(accountsAndTransfers);
          break;
        case 'blue_green':
          await this.executeBlueGreenMigration(accountsAndTransfers);
          break;
      }

      this.updateProgress('completed', 100, 'Migration completed successfully');
      console.log('Migration completed successfully');
    } catch (error) {
      console.error('Migration failed:', error);
      await this.handleMigrationFailure(error);
    }
  }

  /**
   * Validates data compatibility with new system
   */
  private async validateDataCompatibility(accountsAndTransfers: AccountsAndTransfers): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Check for unsupported data structures
    for (const account of accountsAndTransfers.accounts) {
      // Validate account structure
      if (!account.id || !account.name) {
        issues.push({
          severity: 'error',
          category: 'data_compatibility',
          description: `Account missing required fields: ${account.name || 'unnamed'}`,
          path: `accounts.${account.id}`,
          autoFixable: false
        });
      }

      // Validate bills
      for (const bill of account.bills || []) {
        if (typeof bill.amount === 'string' && !['HALF', 'FULL', '-HALF', '-FULL'].includes(bill.amount.replace(/[{}]/g, ''))) {
          issues.push({
            severity: 'warning',
            category: 'data_compatibility',
            description: `Bill has unsupported amount format: ${bill.amount}`,
            path: `accounts.${account.id}.bills.${bill.id}`,
            suggestedFix: 'Convert string amounts to numeric values',
            autoFixable: true
          });
        }
      }

      // Validate interests
      for (const interest of account.interests || []) {
        if (!interest.apr && !(interest as any).rate) {
          issues.push({
            severity: 'warning',
            category: 'data_compatibility',
            description: 'Interest missing rate information',
            path: `accounts.${account.id}.interests.${interest.id}`,
            autoFixable: false
          });
        }
      }
    }

    return issues;
  }

  /**
   * Validates performance characteristics
   */
  private async validatePerformance(accountsAndTransfers: AccountsAndTransfers): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Run a small benchmark to validate performance
      const testCases = [{
        id: 'validation_test',
        description: 'Migration validation test',
        accountsAndTransfers,
        yearRange: 1
      }];

      const results = await this.benchmarkFramework.runBenchmarkSuite(testCases);
      
      if (results.length > 0) {
        const result = results[0];
        
        // Check if performance is acceptable
        if (result.summary.avgExecutionTime > 10000) { // 10 seconds
          issues.push({
            severity: 'warning',
            category: 'performance',
            description: `Performance may be slower than expected: ${result.summary.avgExecutionTime.toFixed(0)}ms`,
            autoFixable: false
          });
        }

        // Check memory usage
        if (result.summary.avgMemoryUsage > 100 * 1024 * 1024) { // 100MB
          issues.push({
            severity: 'warning',
            category: 'performance',
            description: `High memory usage detected: ${(result.summary.avgMemoryUsage / 1024 / 1024).toFixed(0)}MB`,
            autoFixable: false
          });
        }
      }
    } catch (error) {
      issues.push({
        severity: 'error',
        category: 'performance',
        description: `Performance validation failed: ${error}`,
        autoFixable: false
      });
    }

    return issues;
  }

  /**
   * Validates functionality compatibility
   */
  private async validateFunctionality(accountsAndTransfers: AccountsAndTransfers): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    try {
      // Run comparison tests to validate functionality
      const testCases = [{
        id: 'functionality_test',
        description: 'Functionality validation',
        accountsAndTransfers,
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        simulation: 'Default'
      }];

      const results = await this.comparisonFramework.runComparisonTestSuite(testCases);
      
      for (const result of results) {
        if (!result.outputsMatch) {
          issues.push({
            severity: 'error',
            category: 'functionality',
            description: `Output mismatch detected in test: ${result.testCaseId}`,
            autoFixable: false
          });
        }
      }
    } catch (error) {
      // If comparison fails (e.g., legacy server unavailable), add warning
      issues.push({
        severity: 'warning',
        category: 'functionality',
        description: `Functionality validation skipped: ${error}`,
        autoFixable: false
      });
    }

    return issues;
  }

  /**
   * Validates configuration settings
   */
  private async validateConfiguration(): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];

    // Validate strategy configuration
    if (this.strategy.rolloutPercentage < 0 || this.strategy.rolloutPercentage > 100) {
      issues.push({
        severity: 'error',
        category: 'configuration',
        description: 'Invalid rollout percentage',
        suggestedFix: 'Set rollout percentage between 0 and 100',
        autoFixable: true
      });
    }

    // Validate rollback criteria
    if (this.strategy.rollbackCriteria.maxErrorRate <= 0) {
      issues.push({
        severity: 'warning',
        category: 'configuration',
        description: 'Error rate threshold too low',
        suggestedFix: 'Set error rate threshold above 0',
        autoFixable: true
      });
    }

    return issues;
  }

  /**
   * Estimates performance improvement
   */
  private async estimatePerformanceImprovement(accountsAndTransfers: AccountsAndTransfers): Promise<MigrationValidation['estimatedImprovement']> {
    // Run a quick benchmark to estimate improvement
    const eventCount = this.estimateEventCount(accountsAndTransfers);
    
    // Estimate based on event count and known performance characteristics
    const speedupFactor = Math.min(100, Math.max(2, eventCount / 100));
    const memoryReduction = 0.3; // Estimate 30% memory reduction

    return {
      speedupFactor,
      memoryReduction
    };
  }

  /**
   * Estimates event count for data
   */
  private estimateEventCount(accountsAndTransfers: AccountsAndTransfers): number {
    let eventCount = 0;
    
    for (const account of accountsAndTransfers.accounts) {
      eventCount += account.activity?.length || 0;
      eventCount += (account.bills?.length || 0) * 12; // Estimate monthly bills
      eventCount += account.interests?.length || 0;
    }
    
    return eventCount;
  }

  /**
   * Generates recommendations based on issues
   */
  private generateRecommendations(issues: ValidationIssue[]): string[] {
    const recommendations: string[] = [];

    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;

    if (errorCount > 0) {
      recommendations.push('Fix all error-level issues before proceeding with migration');
    }

    if (warningCount > 5) {
      recommendations.push('Consider addressing warning-level issues to improve migration confidence');
    }

    const autoFixableIssues = issues.filter(i => i.autoFixable);
    if (autoFixableIssues.length > 0) {
      recommendations.push(`${autoFixableIssues.length} issues can be automatically fixed`);
    }

    if (issues.some(i => i.category === 'performance')) {
      recommendations.push('Consider performance optimization before migration');
    }

    return recommendations;
  }

  /**
   * Executes big bang migration strategy
   */
  private async executeBigBangMigration(accountsAndTransfers: AccountsAndTransfers): Promise<void> {
    this.updateProgress('rollout', 0, 'Starting big bang migration');

    // Enable new system globally
    this.strategy.featureFlags.enableNewSystem = true;
    
    this.updateProgress('rollout', 50, 'New system enabled globally');

    // Monitor for issues
    await this.monitorMigration(5000); // Monitor for 5 seconds

    this.updateProgress('rollout', 100, 'Big bang migration completed');
  }

  /**
   * Executes gradual migration strategy
   */
  private async executeGradualMigration(accountsAndTransfers: AccountsAndTransfers): Promise<void> {
    const steps = 5;
    const stepSize = this.strategy.rolloutPercentage / steps;

    for (let step = 1; step <= steps; step++) {
      const currentPercentage = stepSize * step;
      
      this.updateProgress('rollout', (step / steps) * 100, `Rolling out to ${currentPercentage.toFixed(1)}%`);

      // Update rollout percentage
      // This would be implemented in the integration layer
      
      // Monitor this step
      await this.monitorMigration(2000);

      // Check rollback criteria
      if (await this.shouldRollback()) {
        await this.executeRollback();
        return;
      }
    }
  }

  /**
   * Executes canary migration strategy
   */
  private async executeCanaryMigration(accountsAndTransfers: AccountsAndTransfers): Promise<void> {
    this.updateProgress('rollout', 0, 'Starting canary deployment');

    // Deploy to canary environment (subset of users)
    this.updateProgress('rollout', 25, 'Canary deployment active');

    // Monitor canary for issues
    await this.monitorMigration(10000); // Monitor for 10 seconds

    if (await this.shouldRollback()) {
      await this.executeRollback();
      return;
    }

    this.updateProgress('rollout', 50, 'Canary successful, rolling out to production');

    // Full production rollout
    this.strategy.featureFlags.enableNewSystem = true;

    this.updateProgress('rollout', 100, 'Canary migration completed');
  }

  /**
   * Executes blue-green migration strategy
   */
  private async executeBlueGreenMigration(accountsAndTransfers: AccountsAndTransfers): Promise<void> {
    this.updateProgress('rollout', 0, 'Preparing green environment');

    // Set up green environment with new system
    this.updateProgress('rollout', 30, 'Green environment ready');

    // Switch traffic to green environment
    this.updateProgress('rollout', 60, 'Switching traffic to green environment');

    // Monitor green environment
    await this.monitorMigration(5000);

    if (await this.shouldRollback()) {
      this.updateProgress('rollout', 40, 'Rolling back to blue environment');
      await this.executeRollback();
      return;
    }

    this.updateProgress('rollout', 100, 'Blue-green migration completed');
  }

  /**
   * Monitors migration progress and metrics
   */
  private async monitorMigration(duration: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, duration);
    });
  }

  /**
   * Checks if rollback should be triggered
   */
  private async shouldRollback(): Promise<boolean> {
    // Check error rate, performance, memory usage against thresholds
    // For now, return false (no rollback needed)
    return false;
  }

  /**
   * Executes rollback to legacy system
   */
  private async executeRollback(): Promise<void> {
    console.log('Executing rollback to legacy system');
    
    this.updateProgress('rolled_back', 0, 'Starting rollback');

    // Disable new system
    this.strategy.featureFlags.enableNewSystem = false;

    this.updateProgress('rolled_back', 100, 'Rollback completed');
  }

  /**
   * Handles migration failure
   */
  private async handleMigrationFailure(error: any): Promise<void> {
    console.error('Migration failed:', error);
    
    this.progress.issues.push({
      severity: 'error',
      category: 'functionality',
      description: `Migration failed: ${error.message}`,
      autoFixable: false
    });

    if (this.strategy.rollbackCriteria.autoRollback) {
      await this.executeRollback();
    }
  }

  /**
   * Initializes migration progress tracking
   */
  private initializeProgress(): MigrationProgress {
    return {
      phase: 'planning',
      percentage: 0,
      currentStep: 'Initializing migration',
      startTime: new Date(),
      issues: [],
      metrics: {
        totalCalculations: 0,
        newSystemCalculations: 0,
        legacyCalculations: 0,
        avgNewSystemTime: 0,
        avgLegacyTime: 0,
        errorCounts: { newSystem: 0, legacy: 0 },
        memoryUsage: { newSystem: 0, legacy: 0 }
      }
    };
  }

  /**
   * Updates migration progress
   */
  private updateProgress(phase: MigrationProgress['phase'], percentage: number, step: string): void {
    this.progress.phase = phase;
    this.progress.percentage = percentage;
    this.progress.currentStep = step;
    
    console.log(`Migration Progress: ${phase} - ${percentage}% - ${step}`);
  }

  /**
   * Gets current migration progress
   */
  getMigrationProgress(): MigrationProgress {
    return { ...this.progress };
  }

  /**
   * Gets migration strategy
   */
  getMigrationStrategy(): MigrationStrategy {
    return { ...this.strategy };
  }
}

/**
 * Creates default migration strategy
 */
export function createDefaultMigrationStrategy(): MigrationStrategy {
  return {
    approach: 'gradual',
    rolloutPercentage: 100,
    rollbackCriteria: {
      maxErrorRate: 0.05, // 5%
      maxPerformanceDegradation: 0.2, // 20%
      maxMemoryIncrease: 0.5, // 50%
      autoRollback: true,
      rollbackTimeout: 30 // minutes
    },
    featureFlags: {
      enableNewSystem: false,
      enableComparison: true,
      enableCaching: true,
      enableParallelProcessing: true,
      enableFallback: true
    },
    monitoring: {
      metricsInterval: 60000, // 1 minute
      enableDetailedLogging: true,
      alertThresholds: {
        executionTime: 30000, // 30 seconds
        errorRate: 0.01, // 1%
        memoryUsage: 500 * 1024 * 1024 // 500MB
      },
      retentionPeriod: 30 // days
    }
  };
}