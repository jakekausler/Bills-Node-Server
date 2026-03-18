import { describe, it, expect } from 'vitest';
import { getActivitiesByName, getBalanceOnDate, getAccountByName } from '../helpers';

describe('Simulation Variable Resolution', () => {
  describe('RETIRE_DATE difference', () => {
    it('Default: paychecks stop at 2028-07-01', () => {
      const paychecks = getActivitiesByName('Checking', 'Alice Paycheck', 'default');
      const lastDate = paychecks[paychecks.length - 1].date.substring(0, 10);
      expect(lastDate <= '2028-07-01').toBe(true);
    });

    it('Conservative: paychecks run until 2029-07-01', () => {
      const paychecks = getActivitiesByName('Checking', 'Alice Paycheck', 'conservative');
      const lastDate = paychecks[paychecks.length - 1].date.substring(0, 10);
      expect(lastDate > '2028-07-01').toBe(true);
      expect(lastDate <= '2029-07-01').toBe(true);
    });

    it('Conservative has more paycheck entries', () => {
      const def = getActivitiesByName('Checking', 'Alice Paycheck', 'default');
      const cons = getActivitiesByName('Checking', 'Alice Paycheck', 'conservative');
      expect(cons.length).toBeGreaterThan(def.length);
    });
  });

  describe('INFLATION difference (3% vs 4%)', () => {
    it('Conservative has higher property tax by year 5', () => {
      // TODO: Calculate property tax in 2030 for both simulations
      // Default: $3,600 * (1.03)^5 with ceiling 100
      // Conservative: $3,600 * (1.04)^5 with ceiling 100
      const defTax = getActivitiesByName('Checking', 'Property Tax', 'default');
      const consTax = getActivitiesByName('Checking', 'Property Tax', 'conservative');
      const def2030 = defTax.find(t => t.date.startsWith('2030'));
      const cons2030 = consTax.find(t => t.date.startsWith('2030'));
      if (def2030 && cons2030) {
        expect(Math.abs(cons2030.amount)).toBeGreaterThan(Math.abs(def2030.amount));
      }
    });
  });

  describe('INVESTMENT_RATE difference (7% vs 5%)', () => {
    it('Default has higher Brokerage balance', () => {
      const defBal = getBalanceOnDate('Brokerage', '2030-12-31', 'default');
      const consBal = getBalanceOnDate('Brokerage', '2030-12-31', 'conservative');
      expect(defBal).toBeGreaterThan(consBal);
    });
  });

  describe('RAISE_RATE difference (3% vs 2%)', () => {
    it('Default has higher paychecks by 2027', () => {
      const defPay = getActivitiesByName('Checking', 'Alice Paycheck', 'default');
      const consPay = getActivitiesByName('Checking', 'Alice Paycheck', 'conservative');
      const def2027 = defPay.filter(p => p.date.startsWith('2027'));
      const cons2027 = consPay.filter(p => p.date.startsWith('2027'));
      if (def2027.length > 0 && cons2027.length > 0) {
        expect(def2027[0].amount).toBeGreaterThan(cons2027[0].amount);
      }
    });
  });

  describe('overall outcome', () => {
    it('Default produces higher net worth than Conservative', () => {
      const accounts = ['Checking', 'HYSA', 'Brokerage', 'Alice 401(k)', 'Bob 401(k)', 'Alice Roth IRA', 'Bob Roth IRA', 'HSA'];
      let defTotal = 0, consTotal = 0;
      accounts.forEach(name => {
        defTotal += getBalanceOnDate(name, '2050-12-31', 'default');
        consTotal += getBalanceOnDate(name, '2050-12-31', 'conservative');
      });
      expect(defTotal).toBeGreaterThan(consTotal);
    });
  });
});
