import { describe, it, expect, beforeEach } from 'vitest';
import { setTaxScenario, computeAnnualFederalTax, getBracketDataForYear } from './bracket-calculator';
import type { TaxScenario } from './tax-profile-types';

describe('Tax Scenario - Bracket Evolution', () => {
  beforeEach(() => {
    // Reset to default scenario for each test
    setTaxScenario({
      name: 'currentPolicy',
      bracketEvolution: 'tcjaPermanent',
      customRates: null,
    });
  });

  describe('tcjaPermanent scenario', () => {
    it('should keep current brackets unchanged for future years', () => {
      const scenario: TaxScenario = {
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      };
      setTaxScenario(scenario);

      // 2030 should inflate from 2025 with standard CPI
      const brackets2030 = getBracketDataForYear(2030, 'mfj');
      const brackets2025 = getBracketDataForYear(2025, 'mfj');

      // Should have same number of brackets (7)
      expect(brackets2030.brackets.mfj).toHaveLength(7);
      expect(brackets2025.brackets.mfj).toHaveLength(7);

      // All rates should be identical (0.37 top rate)
      for (let i = 0; i < 7; i++) {
        expect(brackets2030.brackets.mfj[i].rate).toBe(brackets2025.brackets.mfj[i].rate);
      }
      expect(brackets2030.brackets.mfj[6].rate).toBe(0.37);
    });

    it('should have standard deduction around $30k for MFJ in 2030', () => {
      const scenario: TaxScenario = {
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets2030 = getBracketDataForYear(2030, 'mfj');
      // Standard deduction should inflate normally, roughly $30k-$32k range for 2030
      expect(brackets2030.standardDeduction.mfj).toBeGreaterThan(30000);
      expect(brackets2030.standardDeduction.mfj).toBeLessThan(35000);
    });
  });

  describe('tcjaExpires scenario', () => {
    it('should revert to 7 brackets with 39.6% top rate for 2026+', () => {
      const scenario: TaxScenario = {
        name: 'currentLaw',
        bracketEvolution: 'tcjaExpires',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets2026 = getBracketDataForYear(2026, 'mfj');

      // Should have 7 brackets (like pre-TCJA)
      expect(brackets2026.brackets.mfj).toHaveLength(7);

      // Top rate should be 39.6% (39.6% not 37%)
      expect(brackets2026.brackets.mfj[6].rate).toBe(0.396);
    });

    it('should have lower standard deduction for 2026+ in tcjaExpires', () => {
      const scenario: TaxScenario = {
        name: 'currentLaw',
        bracketEvolution: 'tcjaExpires',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets2026tcjaExpires = getBracketDataForYear(2026, 'mfj');

      // Reset and check tcjaPermanent for comparison
      setTaxScenario({
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      });
      const brackets2026permanent = getBracketDataForYear(2026, 'mfj');

      // tcjaExpires should have lower deduction than tcjaPermanent (reverts toward pre-TCJA ~$12,700)
      expect(brackets2026tcjaExpires.standardDeduction.mfj).toBeLessThan(
        brackets2026permanent.standardDeduction.mfj,
      );
      // Should be roughly $13k-$15k range after inflation from $12,700
      expect(brackets2026tcjaExpires.standardDeduction.mfj).toBeGreaterThan(12000);
      expect(brackets2026tcjaExpires.standardDeduction.mfj).toBeLessThan(18000);
    });

    it('should have narrower bracket thresholds in tcjaExpires vs tcjaPermanent', () => {
      const scenario: TaxScenario = {
        name: 'currentLaw',
        bracketEvolution: 'tcjaExpires',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets2026expires = getBracketDataForYear(2026, 'mfj');

      // Reset and check tcjaPermanent
      setTaxScenario({
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      });
      const brackets2026permanent = getBracketDataForYear(2026, 'mfj');

      // For a mid-range bracket, tcjaExpires should have lower thresholds
      // (because pre-TCJA brackets were narrower)
      expect(brackets2026expires.brackets.mfj[3].max).toBeLessThan(brackets2026permanent.brackets.mfj[3].max);
    });
  });

  describe('rateCreep scenario', () => {
    it('should have narrower brackets when inflated at 80% of CPI', () => {
      const scenario: TaxScenario = {
        name: 'rising',
        bracketEvolution: 'rateCreep',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets2040rateCreep = getBracketDataForYear(2040, 'mfj');

      // Reset and check currentPolicy for comparison
      setTaxScenario({
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      });
      const brackets2040permanent = getBracketDataForYear(2040, 'mfj');

      // rateCreep: 80% inflation means narrower brackets (thresholds don't grow as much)
      // Compare a high bracket threshold
      expect(brackets2040rateCreep.brackets.mfj[5].max).toBeLessThan(brackets2040permanent.brackets.mfj[5].max);

      // Both should still have same top rate
      expect(brackets2040rateCreep.brackets.mfj[6].rate).toBe(brackets2040permanent.brackets.mfj[6].rate);
    });
  });

  describe('custom scenario', () => {
    it('should apply custom bracket multiplier to thresholds', () => {
      const scenario: TaxScenario = {
        name: 'custom',
        bracketEvolution: 'custom',
        customRates: [{ year: 2030, bracketMultiplier: 1.1 }],
      };
      setTaxScenario(scenario);

      const brackets2030custom = getBracketDataForYear(2030, 'mfj');
      const brackets2025 = getBracketDataForYear(2025, 'mfj');

      // Custom 1.1 multiplier should make brackets ~10% wider
      // Compare first bracket max: should be ~10% wider than 2025
      const ratio = brackets2030custom.brackets.mfj[0].max! / brackets2025.brackets.mfj[0].max!;
      expect(ratio).toBeGreaterThan(1.05);
      expect(ratio).toBeLessThan(1.15);
    });

    it('should apply custom multiplier to standard deduction', () => {
      const scenario: TaxScenario = {
        name: 'custom',
        bracketEvolution: 'custom',
        customRates: [{ year: 2030, bracketMultiplier: 1.2 }],
      };
      setTaxScenario(scenario);

      const brackets2030custom = getBracketDataForYear(2030, 'mfj');
      const brackets2025 = getBracketDataForYear(2025, 'mfj');

      // Custom 1.2 multiplier on deduction
      const ratio = brackets2030custom.standardDeduction.mfj / brackets2025.standardDeduction.mfj;
      expect(ratio).toBeGreaterThan(1.15);
      expect(ratio).toBeLessThan(1.25);
    });
  });

  describe('Known years unchanged', () => {
    it('should return exact 2024 brackets regardless of scenario', () => {
      const brackets2024Scenario1 = getBracketDataForYear(2024, 'mfj');

      setTaxScenario({
        name: 'currentLaw',
        bracketEvolution: 'tcjaExpires',
        customRates: null,
      });
      const brackets2024Scenario2 = getBracketDataForYear(2024, 'mfj');

      setTaxScenario({
        name: 'rising',
        bracketEvolution: 'rateCreep',
        customRates: null,
      });
      const brackets2024Scenario3 = getBracketDataForYear(2024, 'mfj');

      // All should be identical
      expect(JSON.stringify(brackets2024Scenario1)).toBe(JSON.stringify(brackets2024Scenario2));
      expect(JSON.stringify(brackets2024Scenario1)).toBe(JSON.stringify(brackets2024Scenario3));
    });

    it('should return exact 2025 brackets regardless of scenario', () => {
      const brackets2025Scenario1 = getBracketDataForYear(2025, 'mfj');

      setTaxScenario({
        name: 'currentLaw',
        bracketEvolution: 'tcjaExpires',
        customRates: null,
      });
      const brackets2025Scenario2 = getBracketDataForYear(2025, 'mfj');

      expect(JSON.stringify(brackets2025Scenario1)).toBe(JSON.stringify(brackets2025Scenario2));
    });
  });

  describe('Tax calculation with scenarios', () => {
    it('should compute different taxes under tcjaPermanent vs tcjaExpires', () => {
      // High earner scenario
      const ordinaryIncome = 200000;
      const ssIncome = 0;

      // tcjaPermanent scenario
      setTaxScenario({
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      });
      const tax2030Permanent = computeAnnualFederalTax(ordinaryIncome, ssIncome, 'mfj', 2030, 0.03);

      // tcjaExpires scenario
      setTaxScenario({
        name: 'currentLaw',
        bracketEvolution: 'tcjaExpires',
        customRates: null,
      });
      const tax2030Expires = computeAnnualFederalTax(ordinaryIncome, ssIncome, 'mfj', 2030, 0.03);

      // tcjaExpires should have higher tax (higher top rate of 39.6% vs 37%)
      expect(tax2030Expires.tax).toBeGreaterThan(tax2030Permanent.tax);
    });
  });

  describe('All filing statuses', () => {
    it('should handle single filing status correctly', () => {
      const scenario: TaxScenario = {
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets = getBracketDataForYear(2030, 'single');
      expect(brackets.brackets.single).toHaveLength(7);
      expect(brackets.standardDeduction.single).toBeGreaterThan(15000);
    });

    it('should handle head of household filing status correctly', () => {
      const scenario: TaxScenario = {
        name: 'currentPolicy',
        bracketEvolution: 'tcjaPermanent',
        customRates: null,
      };
      setTaxScenario(scenario);

      const brackets = getBracketDataForYear(2030, 'hoh');
      expect(brackets.brackets.hoh).toHaveLength(7);
      expect(brackets.standardDeduction.hoh).toBeGreaterThan(20000);
    });
  });
});
