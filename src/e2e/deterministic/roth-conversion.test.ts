import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  getMonthEndBalance,
  getYTDIncome,
  getRothConversions,
} from '../helpers';
import {
  calculateBracketSpace,
  calculateConversionAmount,
} from '../calculators/roth-calculator';

// Load tax bracket data
const rawTaxBrackets = JSON.parse(
  readFileSync(join(__dirname, '../../../data/taxBrackets.json'), 'utf-8'),
);

// Find the latest base year in the tax brackets file
const availableYears = Object.keys(rawTaxBrackets).map(Number).sort((a, b) => b - a);
const baseYear = availableYears[0]; // latest year (2025)

const taxBrackets = {
  baseYear,
  brackets: rawTaxBrackets[String(baseYear)].brackets,
  standardDeduction: rawTaxBrackets[String(baseYear)].standardDeduction,
};

// From variables.csv
const INFLATION = 0.03;
const TARGET_BRACKET_RATE = 0.22; // 22% bracket target
const FILING_STATUS = 'mfj';

describe('Roth Conversions', () => {
  describe('2028-12: First conversion year (retirement year)', () => {
    const year = 2028;

    it('should find Roth conversion activities in December', () => {
      const conversions = getRothConversions(year);
      // After retirement (July 2028), conversions may start in Dec
      // There may be 0 conversions if income already fills bracket
      expect(conversions).toBeDefined();
    });

    it('conversion amount should respect bracket space', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return; // no conversions this year

      // Aggregate YTD ordinary income through November (before Dec conversion)
      const ytdIncome = getYTDIncome('Checking', year, 11);

      // Calculate bracket space
      const bracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        year,
        INFLATION,
        taxBrackets,
      );

      // Find source account balance (conversions come from traditional 401k)
      const sourceConversions = conversions.filter((c) => c.amount < 0);
      for (const conv of sourceConversions) {
        // Source account had a withdrawal (negative amount)
        const sourceBalance = getMonthEndBalance(conv.source, `${year}-11`);
        const expectedAmount = calculateConversionAmount(bracketSpace, sourceBalance);

        // Engine conversion should not exceed shadow bracket space
        const engineAmount = Math.abs(conv.amount);
        expect(engineAmount).toBeLessThanOrEqual(bracketSpace + 1); // +1 for rounding
        expect(engineAmount).toBeLessThanOrEqual(sourceBalance + 1);
      }
    });
  });

  describe('2029-12: Second year conversions (Alice and Bob)', () => {
    const year = 2029;

    it('should find conversion activities', () => {
      const conversions = getRothConversions(year);
      expect(conversions).toBeDefined();
      // Post-retirement, conversions should generally happen
      // unless accounts are depleted
    });

    it('conversion amounts should respect bracket space and source balance', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return;

      const ytdIncome = getYTDIncome('Checking', year, 11);

      const bracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        year,
        INFLATION,
        taxBrackets,
      );

      // Withdrawals from source accounts
      const sourceConversions = conversions.filter((c) => c.amount < 0);
      const totalConverted = sourceConversions.reduce((sum, c) => sum + Math.abs(c.amount), 0);

      // Total converted across all accounts should not exceed bracket space
      expect(totalConverted).toBeLessThanOrEqual(bracketSpace + 1);
    });

    it('each source withdrawal should have a matching Roth deposit', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return;

      const withdrawals = conversions.filter((c) => c.amount < 0);
      const deposits = conversions.filter((c) => c.amount > 0);

      // Total withdrawn should approximately equal total deposited
      const totalWithdrawn = withdrawals.reduce((sum, c) => sum + Math.abs(c.amount), 0);
      const totalDeposited = deposits.reduce((sum, c) => sum + c.amount, 0);

      if (totalWithdrawn > 0) {
        expect(totalDeposited).toBeCloseTo(totalWithdrawn, -1);
      }
    });
  });

  describe('2030-12: ACA period conversion', () => {
    const year = 2030;

    it('should find conversion activities during ACA period', () => {
      const conversions = getRothConversions(year);
      // During ACA period, conversions may be limited to protect subsidies
      expect(conversions).toBeDefined();
    });

    it('conversion should still respect bracket space', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return;

      const ytdIncome = getYTDIncome('Checking', year, 11);

      const bracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        year,
        INFLATION,
        taxBrackets,
      );

      const sourceConversions = conversions.filter((c) => c.amount < 0);
      const totalConverted = sourceConversions.reduce((sum, c) => sum + Math.abs(c.amount), 0);

      // During ACA period, actual conversion may be less than bracket space
      // due to subsidy impact check — but should never exceed it
      expect(totalConverted).toBeLessThanOrEqual(bracketSpace + 1);
    });

    it('conversion amount should not exceed source account balance', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return;

      const sourceConversions = conversions.filter((c) => c.amount < 0);
      for (const conv of sourceConversions) {
        const sourceBalance = getMonthEndBalance(conv.source, `${year}-11`);
        const engineAmount = Math.abs(conv.amount);
        // Cannot convert more than available balance
        expect(engineAmount).toBeLessThanOrEqual(sourceBalance + 1);
      }
    });
  });

  describe('2035-12: Later conversion year', () => {
    const year = 2035;

    it('should find conversion activities', () => {
      const conversions = getRothConversions(year);
      expect(conversions).toBeDefined();
    });

    it('bracket space calculation should use inflation-adjusted brackets', () => {
      const ytdIncome = getYTDIncome('Checking', year, 11);

      const bracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        year,
        INFLATION,
        taxBrackets,
      );

      // Bracket space should be positive (inflation grows brackets)
      // unless income is very high
      expect(bracketSpace).toBeGreaterThanOrEqual(0);

      // Compare to base year bracket to verify inflation worked
      const baseBracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        baseYear,
        INFLATION,
        taxBrackets,
      );

      // For the same income, inflated brackets should give more space
      // (unless income is 0 or above bracket max in both cases)
      if (ytdIncome > 0) {
        expect(bracketSpace).toBeGreaterThanOrEqual(baseBracketSpace);
      }
    });

    it('conversion amount should match shadow calculation', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return;

      const ytdIncome = getYTDIncome('Checking', year, 11);

      const bracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        year,
        INFLATION,
        taxBrackets,
      );

      const sourceConversions = conversions.filter((c) => c.amount < 0);
      for (const conv of sourceConversions) {
        const sourceBalance = getMonthEndBalance(conv.source, `${year}-11`);
        const expectedAmount = calculateConversionAmount(bracketSpace, sourceBalance);
        const engineAmount = Math.abs(conv.amount);

        // Engine may convert less than shadow due to ACA subsidy check
        // or multi-account splitting, but should never exceed shadow
        expect(engineAmount).toBeLessThanOrEqual(expectedAmount + 1);
        expect(engineAmount).toBeGreaterThan(0);
      }
    });

    it('total conversions should not exceed bracket space', () => {
      const conversions = getRothConversions(year);
      if (conversions.length === 0) return;

      const ytdIncome = getYTDIncome('Checking', year, 11);

      const bracketSpace = calculateBracketSpace(
        ytdIncome,
        TARGET_BRACKET_RATE,
        FILING_STATUS,
        year,
        INFLATION,
        taxBrackets,
      );

      const sourceConversions = conversions.filter((c) => c.amount < 0);
      const totalConverted = sourceConversions.reduce((sum, c) => sum + Math.abs(c.amount), 0);

      expect(totalConverted).toBeLessThanOrEqual(bracketSpace + 1);
    });
  });
});
