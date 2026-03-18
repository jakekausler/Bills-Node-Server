import { describe, it, expect } from 'vitest';
import { getActivities, getHealthcareActivities } from '../helpers';

describe('Healthcare', () => {
  describe('employer plan -- deductible/OOP', () => {
    it('2026 Alice ER: patient cost less than full $8,000', () => {
      // TODO: Calculate patient cost through deductible ($1,500) + coinsurance (20%)
      const activities = getActivities('Checking');
      const er = activities.find(a => a.name === 'Alice ER Visit');
      expect(er).toBeDefined();
      // Patient cost should be < $8,000 due to insurance
      // TODO: Calculate exact patient cost accounting for prior deductible usage
      expect(Math.abs(er!.amount)).toBeCloseTo(0, -2); // PLACEHOLDER
    });

    it('2026 Alice Surgery: cost capped at remaining OOP max', () => {
      // TODO: Calculate remaining OOP after ER visit, surgery caps at that
      const activities = getActivities('Checking');
      const surgery = activities.find(a => a.name === 'Alice Surgery');
      expect(surgery).toBeDefined();
      expect(Math.abs(surgery!.amount)).toBeCloseTo(0, -2); // PLACEHOLDER
    });
  });

  describe('plan transitions', () => {
    it('COBRA charges appear after retirement (2028-07+)', () => {
      const activities = getActivities('Checking');
      const cobra = activities.filter(a => a.name.toLowerCase().includes('cobra') && a.date.substring(0, 10) >= '2028-07-01');
      expect(cobra.length).toBeGreaterThan(0);
    });

    it('ACA premiums appear after COBRA ends (~2030-01+)', () => {
      const activities = getActivities('Checking');
      const aca = activities.filter(a => a.name.toLowerCase().includes('aca') && a.date.substring(0, 10) >= '2030-01-01');
      expect(aca.length).toBeGreaterThan(0);
    });

    it('Medicare premiums appear after Alice turns 65 (2035-03+)', () => {
      const activities = getActivities('Checking');
      const medicare = activities.filter(a => a.name.toLowerCase().includes('medicare') && a.date.substring(0, 10) >= '2035-03-15');
      expect(medicare.length).toBeGreaterThan(0);
    });
  });

  describe('HSA reimbursement', () => {
    it('HSA NOT used for employer plan healthcare (before retirement)', () => {
      const hsaActivities = getActivities('HSA');
      const preRetirement = hsaActivities.filter(a => a.date.substring(0, 10) < '2028-07-01' && a.amount < 0);
      // Should have no healthcare reimbursements before retirement
      const reimbursements = preRetirement.filter(a => a.name.toLowerCase().includes('reimburse'));
      expect(reimbursements.length).toBe(0);
    });
  });
});
