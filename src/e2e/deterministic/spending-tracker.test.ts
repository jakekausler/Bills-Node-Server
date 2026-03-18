import { describe, it, expect } from 'vitest';
import { getActivities } from '../helpers';

describe('Spending Tracker', () => {
  describe('category tagging', () => {
    it('bills tagged to spending categories produce tracker activities', () => {
      const activities = getActivities('Checking');
      // TODO: Find exact spending tracker activity names
      expect(activities.length).toBeGreaterThan(0);
    });
  });

  describe('carry-under (Emergency)', () => {
    it('2026 Emergency Plumbing of $4,500 exceeds $3,000 threshold', () => {
      const activities = getActivities('Checking');
      const emergency = activities.find(a => a.name === 'Emergency Plumbing');
      expect(emergency).toBeDefined();
      expect(Math.abs(emergency!.amount)).toBe(4500);
    });
  });

  describe('threshold change', () => {
    it('Shared Spending threshold changes in March 2028', () => {
      // TODO: Verify spending tracker behavior changes at threshold change date
      // Structural check -- activities exist across the threshold change
      const activities = getActivities('Checking');
      expect(activities.length).toBeGreaterThan(0);
    });
  });
});
