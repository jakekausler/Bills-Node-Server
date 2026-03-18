import { describe, it, expect } from 'vitest';
import { getDefaultResult, getConservativeResult, getAccountByName } from '../helpers';

describe('E2E Smoke Test', () => {
  it('should have loaded default results', () => {
    const result = getDefaultResult();
    expect(result).toBeDefined();
    expect(result.accounts).toBeDefined();
    expect(result.accounts.length).toBeGreaterThan(0);
  });

  it('should have loaded conservative results', () => {
    const result = getConservativeResult();
    expect(result).toBeDefined();
    expect(result.accounts.length).toBeGreaterThan(0);
  });

  it('should find Checking account with activities', () => {
    const checking = getAccountByName('Checking');
    expect(checking).toBeDefined();
    expect(checking.consolidatedActivity.length).toBeGreaterThan(0);
  });

  it('should have different results for Default vs Conservative', () => {
    const dc = getAccountByName('Checking', 'default');
    const cc = getAccountByName('Checking', 'conservative');
    const df = dc.consolidatedActivity[dc.consolidatedActivity.length - 1].balance;
    const cf = cc.consolidatedActivity[cc.consolidatedActivity.length - 1].balance;
    expect(df).not.toBe(cf);
  });
});
