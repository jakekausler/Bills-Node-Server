import { describe, it, expect } from 'vitest';
import { getActivities } from '../helpers';

describe('Tax System', () => {
  describe('annual tax payment', () => {
    it('tax payment appears annually in Checking', () => {
      const activities = getActivities('Checking');
      // TODO: Find the exact activity name the engine uses for tax payments
      const taxPayments = activities.filter(a =>
        a.name.toLowerCase().includes('tax') && a.amount < 0
      );
      expect(taxPayments.length).toBeGreaterThan(0);
    });
  });

  describe('progressive brackets (MFJ)', () => {
    it('pre-retirement tax reflects dual income in 22% bracket territory', () => {
      // TODO: Calculate 2025 taxable income:
      // Alice: $4,200 biweekly * 26 = $109,200
      // Bob: $2,800 biweekly * 26 = $72,800
      // Total: $182,000 - standard deduction MFJ (~$30,000) = ~$152,000 taxable
      // Apply 2025 MFJ brackets to get expected tax
      const activities = getActivities('Checking');
      const tax2025 = activities.filter(a =>
        a.name.toLowerCase().includes('tax') && a.date.startsWith('2025') && a.amount < 0
      );
      if (tax2025.length > 0) {
        const totalTax = tax2025.reduce((sum, a) => sum + a.amount, 0);
        expect(Math.abs(totalTax)).toBeCloseTo(0, -2); // PLACEHOLDER -- calculated from brackets
      }
    });

    it('post-retirement tax is lower (pension only income)', () => {
      // 2029: Only pension income (no paychecks, no SS yet)
      // Tax should be lower than pre-retirement
      const activities = getActivities('Checking');
      const tax2025 = activities.filter(a => a.name.toLowerCase().includes('tax') && a.date.startsWith('2025') && a.amount < 0);
      const tax2029 = activities.filter(a => a.name.toLowerCase().includes('tax') && a.date.startsWith('2029') && a.amount < 0);
      if (tax2025.length > 0 && tax2029.length > 0) {
        expect(Math.abs(tax2029.reduce((s, a) => s + a.amount, 0))).toBeLessThan(
          Math.abs(tax2025.reduce((s, a) => s + a.amount, 0))
        );
      }
    });
  });

  describe('SS taxation', () => {
    it('SS income partially taxed after Alice starts SS (2037+)', () => {
      // TODO: Calculate provisional income and determine SS taxation tier
      const activities = getActivities('Checking');
      const tax2038 = activities.filter(a => a.name.toLowerCase().includes('tax') && a.date.startsWith('2038') && a.amount < 0);
      expect(tax2038.length).toBeGreaterThan(0);
    });
  });
});
