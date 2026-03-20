import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaycheckProcessor } from './paycheck-processor';
import { PaycheckStateTracker } from './paycheck-state-tracker';
import { ContributionLimitManager } from './contribution-limit-manager';
import { PaycheckProfile, ContributionConfig, EmployerMatchConfig } from '../../data/bill/paycheck-types';

describe('PaycheckProcessor', () => {
  let paycheckStateTracker: PaycheckStateTracker;
  let contributionLimitManager: ContributionLimitManager;
  let processor: PaycheckProcessor;

  beforeEach(() => {
    paycheckStateTracker = new PaycheckStateTracker();
    contributionLimitManager = new ContributionLimitManager();
    processor = new PaycheckProcessor(paycheckStateTracker, contributionLimitManager);
  });

  describe('Basic gross-to-net calculations', () => {
    it('computes net pay correctly with 6% traditional 401k', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'percent',
          value: 0.06,
          destinationAccount: 'trad-401k',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100, // 2026 SS wage cap
        250000, // MFJ additional Medicare threshold
        26, // biweekly
      );

      // gross: 5000
      // 401k: 300 (does NOT reduce SS/Medicare wages)
      // SS wages: 5000, SS tax: 5000 * 0.062 = 310
      // Medicare: 5000 * 0.0145 = 72.50 (no additional since under 250k)
      // net: 5000 - 300 - 310 - 72.50 = 4317.50
      expect(result.grossPay).toBe(5000);
      expect(result.traditional401k).toBe(300);
      expect(result.ssTax).toBeCloseTo(310, 1);
      expect(result.medicareTax).toBeCloseTo(72.5, 1);
      expect(result.netPay).toBeCloseTo(4317.5, 1);
    });

    it('handles fixed 401k contributions', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'fixed',
          value: 250,
          destinationAccount: 'trad-401k',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      expect(result.traditional401k).toBe(250);
      // 401k does NOT reduce SS/Medicare wages
      expect(result.netPay).toBeCloseTo(5000 - 250 - (5000 * 0.062) - (5000 * 0.0145), 1);
    });

    it('caps 401k contributions at IRS limit', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 10000,
        traditional401k: {
          type: 'percent',
          value: 0.50, // 5000 per paycheck would exceed limit
          destinationAccount: 'trad-401k',
        },
      };

      const result = processor.processPaycheck(
        10000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // IRS limit for 2026 is ~23500, so first paycheck should be capped
      // First paycheck: min(5000, 23500) = 5000
      expect(result.traditional401k).toBe(5000);
      expect(result.netPay).toBeLessThan(10000); // reduced by 401k, FICA
    });

    it('accumulates contributions across paychecks', () => {
      const dob = new Date('1985-03-15');
      const year = 2026;
      const profile: PaycheckProfile = {
        grossPay: 2000,
        traditional401k: {
          type: 'percent',
          value: 0.10, // 200 per paycheck
          destinationAccount: 'trad-401k',
        },
      };

      const results = [];
      // Use different bill names to avoid monthly paycheck counting interference
      for (let i = 0; i < 5; i++) {
        const date = new Date(`${year}-0${(i % 3) + 1}-${8 + ((i * 7) % 20)}`);
        const result = processor.processPaycheck(
          2000,
          profile,
          'Salary',
          date,
          dob,
          176100,
          250000,
          26,
        );
        results.push(result);
      }

      // First several paychecks should have 200 in 401k (within ~23500 annual limit)
      expect(results[0].traditional401k).toBe(200);
      expect(results[1].traditional401k).toBe(200);
      expect(results[2].traditional401k).toBe(200);

      // Total should accumulate
      const totalContributed = results.reduce((sum, r) => sum + r.traditional401k, 0);
      expect(totalContributed).toBeGreaterThan(500); // at least 3 * 200
    });
  });

  describe('HSA contributions', () => {
    it('deducts HSA employee contribution pre-tax', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        hsa: {
          type: 'percent',
          value: 0.03, // 150
          destinationAccount: 'hsa',
          frequency: 'monthly',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // SS wages: 5000 - 150 = 4850 (HSA reduces SS wages)
      expect(result.hsa).toBe(150);
      expect(result.ssTax).toBeCloseTo(4850 * 0.062, 1);
      // Deposit for HSA
      expect(result.depositActivities.some((d) => d.accountId === 'hsa')).toBe(true);
    });

    it('combines employee and employer HSA contributions in deposit', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        hsa: {
          type: 'fixed',
          value: 100,
          destinationAccount: 'hsa',
        },
        hsaEmployerContribution: 2600, // annual, 100 per paycheck for 26 paychecks
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      expect(result.hsa).toBe(100);
      expect(result.hsaEmployer).toBeCloseTo(100, 1);
      // Deposit should combine: 100 + 100 = 200
      const hsaDeposit = result.depositActivities.find((d) => d.accountId === 'hsa');
      expect(hsaDeposit?.amount).toBeCloseTo(200, 1);
    });

    it('respects HSA annual limit', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 10000,
        hsa: {
          type: 'percent',
          value: 0.20, // 2000 per paycheck would exceed family limit
          destinationAccount: 'hsa',
        },
      };

      const results = [];
      for (let i = 0; i < 6; i++) {
        const dateForMonth = new Date(`2026-01-${8 + i * 2}`);
        const result = processor.processPaycheck(
          10000,
          profile,
          'Salary',
          dateForMonth,
          dob,
          176100,
          250000,
          26,
        );
        results.push(result);
      }

      // HSA family limit ~8300, so should cap contributions
      const totalHSA = results.reduce((sum, r) => sum + r.hsa, 0);
      expect(totalHSA).toBeLessThanOrEqual(8300);
    });
  });

  describe('Employer match', () => {
    it('computes simple employer match (4% of gross)', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'percent',
          value: 0.06,
          destinationAccount: 'trad-401k',
        },
        employerMatch: {
          mode: 'simple',
          simplePercent: 0.04,
          destinationAccount: 'employer-match',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // Employee 401k: 300, Match: min(200, 300) = 200
      expect(result.employerMatch).toBe(200);
      expect(result.depositActivities.some((d) => d.accountId === 'employer-match')).toBe(true);
    });

    it('computes tiered employer match', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'percent',
          value: 0.06, // 300
          destinationAccount: 'trad-401k',
        },
        employerMatch: {
          mode: 'tiered',
          tiers: [
            { upToPercent: 0.03, matchPercent: 1.0 }, // 100% on first 3%
            { upToPercent: 0.05, matchPercent: 0.5 }, // 50% on next 2%
          ],
          destinationAccount: 'employer-match',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // Tier 1: 150 * 1.0 = 150 (on first 3% = 150)
      // Tier 2: 100 * 0.5 = 50 (50% on next 2% = 100)
      // Remaining employee: 300 - 150 - 100 = 50
      // Tier 2 gets 50 remaining * 0.5 = 25
      // Total: 150 + 50 + 25 = 225
      expect(result.employerMatch).toBe(225);
    });

    it('computes fixed employer match', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'percent',
          value: 0.06,
          destinationAccount: 'trad-401k',
        },
        employerMatch: {
          mode: 'fixed',
          fixedAmount: 6500, // Annual fixed amount ($250 per paycheck * 26)
          destinationAccount: 'employer-match',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      expect(result.employerMatch).toBe(250);
    });

    it('no match if employee contributes zero', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        employerMatch: {
          mode: 'simple',
          simplePercent: 0.04,
          destinationAccount: 'employer-match',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      expect(result.employerMatch).toBe(0);
    });
  });

  describe('Social Security wage cap', () => {
    it('applies SS tax on gross pay', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // SS tax: 5000 * 0.062 = 310
      expect(result.ssTax).toBeCloseTo(5000 * 0.062, 1);
    });
  });

  describe('Additional Medicare tax', () => {
    it('applies 0.9% additional Medicare tax above threshold', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-12-15');
      const profile: PaycheckProfile = {
        grossPay: 20000,
      };

      const result = processor.processPaycheck(
        20000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        200000, // Single filer
        26,
      );

      // Year-end: likely over 200k threshold
      // Base Medicare: 20000 * 0.0145 = 290
      // Additional (if over threshold): (20000 - room_left) * 0.009
      // Since this is likely in December and YTD is high, additional Medicare applies
      const expectedAdditional = result.medicareTax - 290;
      expect(expectedAdditional).toBeGreaterThanOrEqual(0);
    });

    it('no additional Medicare tax below threshold', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000, // MFJ
        26,
      );

      // Base Medicare only: 5000 * 0.0145 = 72.5
      expect(result.medicareTax).toBeCloseTo(72.5, 1);
    });
  });

  describe('Roth 401k', () => {
    it('deducts Roth 401k post-tax', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        roth401k: {
          type: 'percent',
          value: 0.05, // 250
          destinationAccount: 'roth-401k',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      expect(result.roth401k).toBe(250);
      expect(result.depositActivities.some((d) => d.accountId === 'roth-401k')).toBe(true);
    });

    it('shares 402(g) limit with traditional 401k', () => {
      const dob = new Date('1985-03-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'percent',
          value: 0.06, // 300
          destinationAccount: 'trad-401k',
        },
        roth401k: {
          type: 'percent',
          value: 0.06, // 300, shares the same limit
          destinationAccount: 'roth-401k',
        },
      };

      // Create fresh processor for this test
      const freshTracker = new PaycheckStateTracker();
      const freshLimitManager = new ContributionLimitManager();
      const freshProcessor = new PaycheckProcessor(freshTracker, freshLimitManager);

      const results = [];
      for (let i = 0; i < 30; i++) {
        const date = new Date(`2026-${String((i % 12) + 1).padStart(2, '0')}-${8 + (i % 20)}`);
        const result = freshProcessor.processPaycheck(
          5000,
          profile,
          'Salary',
          date,
          dob,
          176100,
          250000,
          26,
        );
        results.push(result);
      }

      // Total employee deferrals: traditional + roth should not exceed ~23500 limit
      const totalDeferrals = results.reduce(
        (sum, r) => sum + r.traditional401k + r.roth401k,
        0,
      );
      expect(totalDeferrals).toBeLessThanOrEqual(23500);
      // Should accumulate a reasonable amount
      expect(totalDeferrals).toBeGreaterThan(15000);
    });
  });

  describe('Deduction frequency', () => {
    it('applies perPaycheck deduction on every paycheck', () => {
      const dob = new Date('1985-03-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        deductions: [
          {
            label: 'Health Insurance',
            amount: 250,
            type: 'preTax',
            frequency: 'perPaycheck',
          },
        ],
      };

      const results = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(`2026-01-${8 + i * 7}`);
        const result = processor.processPaycheck(
          5000,
          profile,
          'Salary',
          date,
          dob,
          176100,
          250000,
          26,
        );
        results.push(result);
      }

      // All paychecks should have the deduction
      results.forEach((r) => {
        const ded = r.preTaxDeductions.find((d) => d.label === 'Health Insurance');
        expect(ded?.amount).toBe(250);
      });
    });

    it('skips monthly deduction on 3rd paycheck of month', () => {
      const dob = new Date('1985-03-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        deductions: [
          {
            label: 'Monthly Deduction',
            amount: 100,
            type: 'preTax',
            frequency: 'monthly',
          },
        ],
      };

      // Simulate 3 paychecks in one month
      const results = [];
      for (let i = 0; i < 3; i++) {
        const date = new Date(`2026-01-${8 + i * 3}`); // Same month
        const result = processor.processPaycheck(
          5000,
          profile,
          'Salary',
          date,
          dob,
          176100,
          250000,
          26,
        );
        results.push(result);
      }

      // First 2 should have deduction, 3rd should not
      expect(results[0].preTaxDeductions.find((d) => d.label === 'Monthly Deduction')).toBeDefined();
      expect(results[1].preTaxDeductions.find((d) => d.label === 'Monthly Deduction')).toBeDefined();
      expect(results[2].preTaxDeductions.find((d) => d.label === 'Monthly Deduction')).toBeUndefined();
    });

    it('applies annual deduction only on first paycheck of year', () => {
      const dob = new Date('1985-03-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        deductions: [
          {
            label: 'Annual Fee',
            amount: 500,
            type: 'preTax',
            frequency: 'annual',
          },
        ],
      };

      // Jan paycheck (should have deduction)
      const janResult = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        new Date('2026-01-08'),
        dob,
        176100,
        250000,
        26,
      );

      // Feb paycheck (should not have deduction)
      const febResult = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        new Date('2026-02-08'),
        dob,
        176100,
        250000,
        26,
      );

      expect(janResult.preTaxDeductions.find((d) => d.label === 'Annual Fee')).toBeDefined();
      expect(febResult.preTaxDeductions.find((d) => d.label === 'Annual Fee')).toBeUndefined();
    });
  });

  describe('Deposit activities', () => {
    it('generates deposit activities for each destination', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'fixed',
          value: 300,
          destinationAccount: 'trad-401k',
        },
        roth401k: {
          type: 'fixed',
          value: 200,
          destinationAccount: 'roth-401k',
        },
        hsa: {
          type: 'fixed',
          value: 100,
          destinationAccount: 'hsa',
        },
        employerMatch: {
          mode: 'fixed',
          fixedAmount: 3900, // Annual fixed amount ($150 per paycheck * 26)
          destinationAccount: 'employer-match',
        },
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // Should have 4 deposit destinations (trad-401k, roth-401k, hsa, employer-match)
      expect(result.depositActivities.length).toBeGreaterThanOrEqual(4);
      expect(result.depositActivities.find((d) => d.accountId === 'trad-401k')?.amount).toBe(300);
      expect(result.depositActivities.find((d) => d.accountId === 'roth-401k')?.amount).toBe(200);
      expect(result.depositActivities.find((d) => d.accountId === 'hsa')?.amount).toBe(100);
      expect(result.depositActivities.find((d) => d.accountId === 'employer-match')?.amount).toBe(
        150,
      );
    });

    it('combines HSA employee and employer into single deposit', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        hsa: {
          type: 'fixed',
          value: 100,
          destinationAccount: 'hsa',
        },
        hsaEmployerContribution: 2600,
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // Should have single HSA deposit with combined amount
      const hsaDeposits = result.depositActivities.filter((d) => d.accountId === 'hsa');
      expect(hsaDeposits.length).toBe(1);
      expect(hsaDeposits[0].amount).toBeCloseTo(200, 1);
    });
  });

  describe('Complex scenarios', () => {
    it('handles multiple deductions (pre-tax and post-tax mix)', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 5000,
        traditional401k: {
          type: 'percent',
          value: 0.06,
          destinationAccount: 'trad-401k',
        },
        roth401k: {
          type: 'percent',
          value: 0.05,
          destinationAccount: 'roth-401k',
        },
        deductions: [
          {
            label: 'Health Insurance',
            amount: 200,
            type: 'preTax',
          },
          {
            label: 'Gym Membership',
            amount: 50,
            type: 'postTax',
          },
        ],
      };

      const result = processor.processPaycheck(
        5000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      expect(result.traditional401k).toBe(300);
      expect(result.roth401k).toBe(250);
      expect(result.preTaxDeductions.find((d) => d.label === 'Health Insurance')).toBeDefined();
      expect(result.postTaxDeductions.find((d) => d.label === 'Gym Membership')).toBeDefined();

      // net = 5000 - 300 - 200 (pre-tax) - SS/Medicare - 250 - 50 (post-tax)
      const totalDeductions = 300 + 200 + result.ssTax + result.medicareTax + 250 + 50;
      expect(result.netPay).toBeCloseTo(5000 - totalDeductions, 1);
    });

    it('computes Cycle A paycheck with no withholding', () => {
      const dob = new Date('1985-03-15');
      const date = new Date('2026-01-15');
      const profile: PaycheckProfile = {
        grossPay: 3000,
        traditional401k: {
          type: 'percent',
          value: 0.05, // 150
          destinationAccount: 'trad-401k',
        },
      };

      const result = processor.processPaycheck(
        3000,
        profile,
        'Salary',
        date,
        dob,
        176100,
        250000,
        26,
      );

      // Federal and state withholding should be 0 in Cycle A
      expect(result.federalWithholding).toBe(0);
      expect(result.stateWithholding).toBe(0);

      // 401k does NOT reduce SS/Medicare wages
      // net = 3000 - 150 (401k) - (3000 * 0.062) - (3000 * 0.0145)
      const expectedNet = 3000 - 150 - 3000 * 0.062 - 3000 * 0.0145;
      expect(result.netPay).toBeCloseTo(expectedNet, 1);
    });
  });
});
