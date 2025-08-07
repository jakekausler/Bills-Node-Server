import * as fs from 'fs';
import * as path from 'path';

interface LogEntry {
  simulation: number;
  month: string;
  date: string;
  type?: string; // Monte Carlo type
  sampleValue?: number; // Monte Carlo sample
  deterministicValue?: number; // Deterministic rate
  segmentKey: string;
  context: string;
  baseAmount: number;
  calculatedAmount: number;
  activityId: string;
  activityName?: string;
  billId?: string;
  billName?: string;
  accountId?: string;
  interestId?: string;
  compounded?: string;
  originalPercentage?: number;
  yearOffset?: number;
  totalYears?: number;
}

interface ValidationResult {
  activityId: string;
  type: string;
  baseAmount: number;
  rate: number;
  expectedAmount: number;
  actualAmount: number;
  difference: number;
  percentError: number;
  passed: boolean;
  context: string;
}

class MonteCarloValidator {
  private deterministicLogs: Map<string, LogEntry> = new Map();
  private monteCarloLogs: Map<number, Map<string, LogEntry>> = new Map();
  private logsDir: string;

  constructor(logsDir: string = path.join(__dirname, '..', '..', '..', 'logs')) {
    this.logsDir = logsDir;
  }

  /**
   * Load and parse log files
   */
  async loadLogs(simulationNumbers: number[]): Promise<void> {
    // Load deterministic logs
    const deterministicPath = path.join(this.logsDir, 'deterministic', 'simulation-1-deterministic.log');
    if (fs.existsSync(deterministicPath)) {
      const lines = fs.readFileSync(deterministicPath, 'utf-8').split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const entry: LogEntry = JSON.parse(line);
          // Use activityId as key for matching
          this.deterministicLogs.set(entry.activityId, entry);
        } catch (error) {
          console.warn(`Failed to parse deterministic log line: ${line}`);
        }
      }
    }

    // Load Monte Carlo logs for each simulation
    for (const simNum of simulationNumbers) {
      const monteCarloPath = path.join(this.logsDir, 'monte-carlo', `simulation-${simNum}-samples.log`);
      if (fs.existsSync(monteCarloPath)) {
        const simLogs = new Map<string, LogEntry>();
        const lines = fs.readFileSync(monteCarloPath, 'utf-8').split('\n').filter(line => line.trim());
        for (const line of lines) {
          try {
            const entry: LogEntry = JSON.parse(line);
            simLogs.set(entry.activityId, entry);
          } catch (error) {
            console.warn(`Failed to parse Monte Carlo log line: ${line}`);
          }
        }
        this.monteCarloLogs.set(simNum, simLogs);
      }
    }

    console.log(`Loaded ${this.deterministicLogs.size} deterministic entries`);
    console.log(`Loaded Monte Carlo logs for ${this.monteCarloLogs.size} simulations`);
  }

  /**
   * Calculate expected amount based on the type of calculation
   */
  private calculateExpectedAmount(entry: LogEntry): number {
    const rate = entry.sampleValue ?? entry.deterministicValue ?? 0;
    const baseAmount = entry.baseAmount;

    // For interest calculations - these are PERIODIC interest payments, not annual
    if (entry.type === 'interest' || entry.context.includes('Interest') || 
        entry.type === 'HYSA' || entry.type === 'LYSA' || entry.type === 'Portfolio') {
      
      // Determine the period based on compounding frequency
      let periodsPerYear = 12; // Default to monthly
      
      if (entry.compounded) {
        switch (entry.compounded.toLowerCase()) {
          case 'day':
          case 'daily':
            periodsPerYear = 365;
            break;
          case 'week':
          case 'weekly':
            periodsPerYear = 52;
            break;
          case 'month':
          case 'monthly':
            periodsPerYear = 12;
            break;
          case 'quarter':
          case 'quarterly':
            periodsPerYear = 4;
            break;
          case 'year':
          case 'yearly':
            periodsPerYear = 1;
            break;
        }
      }

      // Calculate the periodic interest (not compounded, just one period)
      const periodRate = rate / periodsPerYear;
      return baseAmount * periodRate;
    }

    // For bill increases
    if (entry.type === 'bill_increase' || entry.context.includes('Bill')) {
      // Bill increases are typically cumulative year over year
      // The calculatedAmount should be baseAmount * (1 + rate)
      return baseAmount * (1 + rate);
    }

    // Default calculation for other types
    return baseAmount * (1 + rate);
  }

  /**
   * Validate a single Monte Carlo entry against expected calculations
   */
  private validateEntry(mcEntry: LogEntry): ValidationResult {
    const expectedAmount = this.calculateExpectedAmount(mcEntry);
    const actualAmount = mcEntry.calculatedAmount;
    const difference = Math.abs(actualAmount - expectedAmount);
    const percentError = (difference / expectedAmount) * 100;

    // Allow for small floating point errors (0.01% tolerance)
    const passed = percentError < 0.01 || difference < 0.01;

    return {
      activityId: mcEntry.activityId,
      type: mcEntry.type || 'unknown',
      baseAmount: mcEntry.baseAmount,
      rate: mcEntry.sampleValue ?? 0,
      expectedAmount,
      actualAmount,
      difference,
      percentError,
      passed,
      context: mcEntry.context
    };
  }

  /**
   * Compare Monte Carlo calculations with deterministic baseline
   */
  compareWithDeterministic(simulationNumber: number): {
    matches: ValidationResult[],
    mismatches: ValidationResult[]
  } {
    const matches: ValidationResult[] = [];
    const mismatches: ValidationResult[] = [];

    const mcSimLogs = this.monteCarloLogs.get(simulationNumber);
    if (!mcSimLogs) {
      console.warn(`No Monte Carlo logs found for simulation ${simulationNumber}`);
      return { matches, mismatches };
    }

    // For each deterministic entry, find corresponding Monte Carlo entry
    for (const [activityId, detEntry] of this.deterministicLogs) {
      const mcEntry = mcSimLogs.get(activityId);
      
      if (mcEntry) {
        // Validate that the Monte Carlo calculation is correct for its sample value
        const validation = this.validateEntry(mcEntry);
        
        if (validation.passed) {
          matches.push(validation);
        } else {
          mismatches.push(validation);
        }

        // Also verify that if the rates were the same, amounts would match
        if (Math.abs((mcEntry.sampleValue ?? 0) - (detEntry.deterministicValue ?? 0)) < 0.0001) {
          // Rates are the same, so amounts should match
          const amountDiff = Math.abs(mcEntry.calculatedAmount - detEntry.calculatedAmount);
          if (amountDiff > 0.01) {
            console.warn(`Same rate but different amounts for ${activityId}:`, {
              rate: mcEntry.sampleValue,
              mcAmount: mcEntry.calculatedAmount,
              detAmount: detEntry.calculatedAmount,
              difference: amountDiff
            });
          }
        }
      }
    }

    return { matches, mismatches };
  }

  /**
   * Validate all Monte Carlo simulations
   */
  validateAllSimulations(): void {
    const allResults: Map<number, { matches: ValidationResult[], mismatches: ValidationResult[] }> = new Map();

    for (const simNum of this.monteCarloLogs.keys()) {
      console.log(`\n=== Validating Simulation ${simNum} ===`);
      const results = this.compareWithDeterministic(simNum);
      allResults.set(simNum, results);

      console.log(`✓ Matches: ${results.matches.length}`);
      console.log(`✗ Mismatches: ${results.mismatches.length}`);

      if (results.mismatches.length > 0) {
        console.log('\nMismatches found:');
        for (const mismatch of results.mismatches.slice(0, 5)) { // Show first 5
          console.log(`  - ${mismatch.activityId}:`);
          console.log(`    Type: ${mismatch.type}`);
          console.log(`    Base: ${mismatch.baseAmount.toFixed(2)}`);
          console.log(`    Rate: ${(mismatch.rate * 100).toFixed(2)}%`);
          console.log(`    Expected: ${mismatch.expectedAmount.toFixed(2)}`);
          console.log(`    Actual: ${mismatch.actualAmount.toFixed(2)}`);
          console.log(`    Error: ${mismatch.percentError.toFixed(4)}%`);
        }
      }
    }

    // Summary statistics
    console.log('\n=== Overall Summary ===');
    let totalMatches = 0;
    let totalMismatches = 0;
    
    for (const [simNum, results] of allResults) {
      totalMatches += results.matches.length;
      totalMismatches += results.mismatches.length;
    }

    const totalValidated = totalMatches + totalMismatches;
    const successRate = (totalMatches / totalValidated) * 100;

    console.log(`Total entries validated: ${totalValidated}`);
    console.log(`Total matches: ${totalMatches}`);
    console.log(`Total mismatches: ${totalMismatches}`);
    console.log(`Success rate: ${successRate.toFixed(2)}%`);

    // Group mismatches by type to identify patterns
    if (totalMismatches > 0) {
      const mismatchesByType = new Map<string, number>();
      for (const results of allResults.values()) {
        for (const mismatch of results.mismatches) {
          const count = mismatchesByType.get(mismatch.type) || 0;
          mismatchesByType.set(mismatch.type, count + 1);
        }
      }

      console.log('\nMismatches by type:');
      for (const [type, count] of mismatchesByType) {
        console.log(`  ${type}: ${count}`);
      }
    }
  }

  /**
   * Validate specific sample types
   */
  validateByType(type: string): void {
    console.log(`\n=== Validating ${type} Calculations ===`);
    
    const typeResults: ValidationResult[] = [];

    for (const [simNum, simLogs] of this.monteCarloLogs) {
      for (const [activityId, entry] of simLogs) {
        if (entry.type === type || entry.context.toLowerCase().includes(type.toLowerCase())) {
          const validation = this.validateEntry(entry);
          typeResults.push(validation);
        }
      }
    }

    const passed = typeResults.filter(r => r.passed);
    const failed = typeResults.filter(r => !r.passed);

    console.log(`Total ${type} entries: ${typeResults.length}`);
    console.log(`Passed: ${passed.length} (${(passed.length / typeResults.length * 100).toFixed(2)}%)`);
    console.log(`Failed: ${failed.length}`);

    if (failed.length > 0) {
      console.log(`\nSample failures for ${type}:`);
      for (const failure of failed.slice(0, 3)) {
        console.log(`  Activity: ${failure.activityId}`);
        console.log(`  Expected: ${failure.expectedAmount.toFixed(2)}, Actual: ${failure.actualAmount.toFixed(2)}`);
        console.log(`  Error: ${failure.percentError.toFixed(4)}%`);
      }
    }
  }
}

// Main test execution
async function runValidation() {
  console.log('Starting Monte Carlo Validation Test');
  console.log('=====================================\n');

  const validator = new MonteCarloValidator();
  
  // Load logs for simulations 1-5
  await validator.loadLogs([1, 2, 3, 4, 5]);

  // Run overall validation
  validator.validateAllSimulations();

  // Validate specific types
  console.log('\n=== Type-Specific Validation ===');
  validator.validateByType('HYSA');
  validator.validateByType('LYSA');
  validator.validateByType('Portfolio');
  validator.validateByType('Inflation');
  validator.validateByType('Raise');
  validator.validateByType('interest');
  validator.validateByType('bill_increase');

  console.log('\n=== Validation Complete ===');
}

// Run the validation
runValidation().catch(error => {
  console.error('Validation failed:', error);
  process.exit(1);
});