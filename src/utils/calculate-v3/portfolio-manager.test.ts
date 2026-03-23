import { describe, it, expect, beforeEach } from 'vitest';
import { PortfolioManager } from './portfolio-manager';
import type { AccountPortfolioConfig, FundConfig, SellResult } from './portfolio-types';

// ===== Test Helpers =====

function makeFundConfig(overrides: Partial<FundConfig> & Pick<FundConfig, 'symbol' | 'assetClassMapping' | 'currentShares' | 'currentPrice' | 'expenseRatio' | 'contributionWeight'>): FundConfig {
  return {
    name: overrides.symbol,
    dividends: { frequency: 'quarterly', dividendType: 'qualified', reinvest: true, history: [] },
    ...overrides,
  };
}

function makeFundLevelConfig(): AccountPortfolioConfig {
  return {
    mode: 'fund-level',
    allocation: { stock: 0.60, bond: 0.30, cash: 0.10 },
    glidePath: 'none',
    lotSelectionStrategy: 'fifo',
    funds: [
      makeFundConfig({
        symbol: 'FXAIX',
        assetClassMapping: { stock: 1.0 },
        currentShares: 100,
        currentPrice: 200,
        expenseRatio: 0.00015,
        contributionWeight: 0.60,
      }),
      makeFundConfig({
        symbol: 'FXNAX',
        assetClassMapping: { bond: 1.0 },
        currentShares: 50,
        currentPrice: 10,
        expenseRatio: 0.00025,
        contributionWeight: 0.30,
      }),
      makeFundConfig({
        symbol: 'SPRXX',
        assetClassMapping: { cash: 1.0 },
        currentShares: 1000,
        currentPrice: 1,
        expenseRatio: 0.0042,
        contributionWeight: 0.10,
      }),
    ],
  };
}

function makeEstimatedConfig(): AccountPortfolioConfig {
  return {
    mode: 'estimated',
    allocation: { stock: 0.70, bond: 0.20, cash: 0.10 },
    glidePath: 'global',
    lotSelectionStrategy: 'fifo',
  };
}

const simpleReturns: Record<string, number> = {
  stock: 0.10,
  bond: 0.05,
  cash: 0.02,
};

// ===== Tests =====

describe('PortfolioManager', () => {
  let manager: PortfolioManager;

  describe('fund-level initialization', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
    });

    it('creates positions with correct shares, prices, and values from config', () => {
      const positions = manager.getPositions('acc1');
      expect(positions).toHaveLength(3);

      const fxaix = positions.find((p) => p.symbol === 'FXAIX')!;
      expect(fxaix.shares).toBe(100);
      expect(fxaix.currentPrice).toBe(200);
      expect(fxaix.value).toBe(20000);

      const fxnax = positions.find((p) => p.symbol === 'FXNAX')!;
      expect(fxnax.shares).toBe(50);
      expect(fxnax.currentPrice).toBe(10);
      expect(fxnax.value).toBe(500);

      const sprxx = positions.find((p) => p.symbol === 'SPRXX')!;
      expect(sprxx.shares).toBe(1000);
      expect(sprxx.currentPrice).toBe(1);
      expect(sprxx.value).toBe(1000);
    });
  });

  describe('estimated initialization', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc2: makeEstimatedConfig() });
    });

    it('creates virtual funds per asset class allocation at $1.00', () => {
      manager.initializeEstimatedAccount('acc2', 100000);
      const positions = manager.getPositions('acc2');
      expect(positions).toHaveLength(3);

      const stock = positions.find((p) => p.symbol === 'STOCK')!;
      expect(stock.shares).toBe(70000);
      expect(stock.currentPrice).toBe(1.0);
      expect(stock.value).toBe(70000);

      const bond = positions.find((p) => p.symbol === 'BOND')!;
      expect(bond.shares).toBe(20000);
      expect(bond.currentPrice).toBe(1.0);
      expect(bond.value).toBe(20000);

      const cash = positions.find((p) => p.symbol === 'CASH')!;
      expect(cash.shares).toBe(10000);
      expect(cash.currentPrice).toBe(1.0);
      expect(cash.value).toBe(10000);
    });
  });

  describe('applyAnnualReturns — fund-level', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
    });

    it('updates each fund price by weighted asset class return minus expense ratio', () => {
      const interest = manager.applyAnnualReturns('acc1', 2026, simpleReturns);

      const positions = manager.getPositions('acc1');
      const fxaix = positions.find((p) => p.symbol === 'FXAIX')!;
      // stock return 10%, expense 0.015% => net return 0.09985
      const expectedFxaixPrice = 200 * (1 + 0.10 - 0.00015);
      expect(fxaix.currentPrice).toBeCloseTo(expectedFxaixPrice, 4);
      expect(fxaix.value).toBeCloseTo(100 * expectedFxaixPrice, 2);

      const fxnax = positions.find((p) => p.symbol === 'FXNAX')!;
      // bond return 5%, expense 0.025% => net return 0.04975
      const expectedFxnaxPrice = 10 * (1 + 0.05 - 0.00025);
      expect(fxnax.currentPrice).toBeCloseTo(expectedFxnaxPrice, 4);

      const sprxx = positions.find((p) => p.symbol === 'SPRXX')!;
      // cash return 2%, expense 0.42% => net return 0.0158
      const expectedSprxxPrice = 1 * (1 + 0.02 - 0.0042);
      expect(sprxx.currentPrice).toBeCloseTo(expectedSprxxPrice, 4);

      // Interest = sum of value changes
      const expectedInterest =
        100 * (expectedFxaixPrice - 200) +
        50 * (expectedFxnaxPrice - 10) +
        1000 * (expectedSprxxPrice - 1);
      expect(interest).toBeCloseTo(expectedInterest, 2);
    });
  });

  describe('applyAnnualReturns — estimated', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc2: makeEstimatedConfig() });
      manager.initializeEstimatedAccount('acc2', 100000);
    });

    it('updates virtual fund prices by asset class return (no expense ratio)', () => {
      const interest = manager.applyAnnualReturns('acc2', 2026, simpleReturns);

      const positions = manager.getPositions('acc2');
      const stock = positions.find((p) => p.symbol === 'STOCK')!;
      expect(stock.currentPrice).toBeCloseTo(1.10, 4);
      expect(stock.value).toBeCloseTo(70000 * 1.10, 2);

      const bond = positions.find((p) => p.symbol === 'BOND')!;
      expect(bond.currentPrice).toBeCloseTo(1.05, 4);

      const cash = positions.find((p) => p.symbol === 'CASH')!;
      expect(cash.currentPrice).toBeCloseTo(1.02, 4);

      // Total interest = 70000*0.10 + 20000*0.05 + 10000*0.02 = 7000 + 1000 + 200 = 8200
      expect(interest).toBeCloseTo(8200, 2);
    });
  });

  describe('getTotalValue', () => {
    it('returns sum of all positions plus uninvested cash', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
      // Total = 100*200 + 50*10 + 1000*1 + 0 uninvested = 21500
      expect(manager.getTotalValue('acc1')).toBeCloseTo(21500, 2);
    });
  });

  describe('getAccountMode', () => {
    it('returns fund-level for fund-level config', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
      expect(manager.getAccountMode('acc1')).toBe('fund-level');
    });

    it('returns estimated for estimated config', () => {
      manager = new PortfolioManager({ acc2: makeEstimatedConfig() });
      expect(manager.getAccountMode('acc2')).toBe('estimated');
    });

    it('returns null for unknown account (interest mode)', () => {
      manager = new PortfolioManager({});
      expect(manager.getAccountMode('unknown')).toBeNull();
    });
  });

  describe('getConfiguredAccountIds', () => {
    it('returns all configured account IDs', () => {
      manager = new PortfolioManager({
        acc1: makeFundLevelConfig(),
        acc2: makeEstimatedConfig(),
      });
      const ids = manager.getConfiguredAccountIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('acc1');
      expect(ids).toContain('acc2');
    });

    it('returns empty array when no configs', () => {
      manager = new PortfolioManager({});
      expect(manager.getConfiguredAccountIds()).toHaveLength(0);
    });
  });

  describe('estimated initialization from BalanceTracker pattern', () => {
    it('initializes only estimated accounts when iterating all configured IDs', () => {
      manager = new PortfolioManager({
        acc1: makeFundLevelConfig(),
        acc2: makeEstimatedConfig(),
      });

      // Simulate the engine pattern: iterate all configured accounts,
      // initialize only estimated-mode accounts with a balance
      const simulatedBalance = 250000;
      for (const accountId of manager.getConfiguredAccountIds()) {
        if (manager.getAccountMode(accountId) === 'estimated') {
          manager.initializeEstimatedAccount(accountId, simulatedBalance);
        }
      }

      // Fund-level account should be unchanged (initialized from config)
      const fundPositions = manager.getPositions('acc1');
      const fxaix = fundPositions.find((p) => p.symbol === 'FXAIX')!;
      expect(fxaix.shares).toBe(100);
      expect(fxaix.currentPrice).toBe(200);

      // Estimated account should have virtual funds based on balance
      const estPositions = manager.getPositions('acc2');
      expect(estPositions).toHaveLength(3);

      const stock = estPositions.find((p) => p.symbol === 'STOCK')!;
      expect(stock.shares).toBe(175000); // 250000 * 0.70
      expect(stock.currentPrice).toBe(1.0);
      expect(stock.value).toBe(175000);

      const bond = estPositions.find((p) => p.symbol === 'BOND')!;
      expect(bond.shares).toBe(50000); // 250000 * 0.20
      expect(bond.value).toBe(50000);

      const cash = estPositions.find((p) => p.symbol === 'CASH')!;
      expect(cash.shares).toBe(25000); // 250000 * 0.10
      expect(cash.value).toBe(25000);
    });
  });

  describe('checkpoint/restore', () => {
    it('round-trip preserves all state including positions, prices, uninvested cash, lastReturnYear', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
      manager.applyAnnualReturns('acc1', 2026, simpleReturns);

      const checkpoint = manager.checkpoint();

      // Create a fresh manager and restore
      const manager2 = new PortfolioManager({ acc1: makeFundLevelConfig() });
      manager2.restore(checkpoint);

      // Verify positions match
      const pos1 = manager.getPositions('acc1');
      const pos2 = manager2.getPositions('acc1');
      expect(pos2).toHaveLength(pos1.length);
      for (let i = 0; i < pos1.length; i++) {
        expect(pos2[i].symbol).toBe(pos1[i].symbol);
        expect(pos2[i].shares).toBeCloseTo(pos1[i].shares, 6);
        expect(pos2[i].currentPrice).toBeCloseTo(pos1[i].currentPrice, 6);
        expect(pos2[i].value).toBeCloseTo(pos1[i].value, 4);
      }

      // Verify total values match
      expect(manager2.getTotalValue('acc1')).toBeCloseTo(manager.getTotalValue('acc1'), 4);

      // Verify lastReturnYear was preserved — applying returns for same year should return 0
      const interest = manager2.applyAnnualReturns('acc1', 2026, simpleReturns);
      expect(interest).toBe(0);
    });
  });

  describe('compounding over multiple years', () => {
    it('simulated price compounds correctly', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });

      manager.applyAnnualReturns('acc1', 2026, simpleReturns);
      manager.applyAnnualReturns('acc1', 2027, simpleReturns);
      manager.applyAnnualReturns('acc1', 2028, simpleReturns);

      const positions = manager.getPositions('acc1');
      const fxaix = positions.find((p) => p.symbol === 'FXAIX')!;

      // 3 years compounding: 200 * (1 + 0.10 - 0.00015)^3
      const netReturn = 0.10 - 0.00015;
      const expectedPrice = 200 * Math.pow(1 + netReturn, 3);
      expect(fxaix.currentPrice).toBeCloseTo(expectedPrice, 2);
    });
  });

  describe('lastReturnYear prevents double-application', () => {
    it('returns 0 interest when called twice for the same year', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });

      const interest1 = manager.applyAnnualReturns('acc1', 2026, simpleReturns);
      expect(interest1).toBeGreaterThan(0);

      const interest2 = manager.applyAnnualReturns('acc1', 2026, simpleReturns);
      expect(interest2).toBe(0);
    });
  });

  describe('getAllPositions', () => {
    it('returns positions for all accounts', () => {
      manager = new PortfolioManager({
        acc1: makeFundLevelConfig(),
        acc2: makeEstimatedConfig(),
      });
      manager.initializeEstimatedAccount('acc2', 50000);

      const all = manager.getAllPositions();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['acc1']).toHaveLength(3);
      expect(all['acc2']).toHaveLength(3);
    });
  });

  describe('resetStates', () => {
    it('resets all state back to initial config values', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
      manager.applyAnnualReturns('acc1', 2026, simpleReturns);

      // After reset, should be back to original prices
      manager.resetStates();

      const positions = manager.getPositions('acc1');
      const fxaix = positions.find((p) => p.symbol === 'FXAIX')!;
      expect(fxaix.currentPrice).toBe(200);
      expect(fxaix.value).toBe(20000);

      // Should be able to apply returns for 2026 again
      const interest = manager.applyAnnualReturns('acc1', 2026, simpleReturns);
      expect(interest).toBeGreaterThan(0);
    });
  });

  describe('createLot', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
    });

    it('adds a lot with correct fields (id, shares, costBasis, date, source)', () => {
      const lot = manager.createLot('acc1', 'FXAIX', 10, 200, '2025-01-15', 'contribution');

      expect(lot.id).toBeDefined();
      expect(lot.accountId).toBe('acc1');
      expect(lot.fundSymbol).toBe('FXAIX');
      expect(lot.shares).toBe(10);
      expect(lot.costBasisPerShare).toBe(200);
      expect(lot.totalCost).toBe(2000);
      expect(lot.purchaseDate).toBe('2025-01-15');
      expect(lot.source).toBe('contribution');
    });
  });

  describe('consumeLots', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
    });

    it('FIFO: sells oldest lots first', () => {
      manager.createLot('acc1', 'FXAIX', 10, 180, '2024-01-01', 'contribution');
      manager.createLot('acc1', 'FXAIX', 10, 200, '2024-06-01', 'contribution');
      manager.createLot('acc1', 'FXAIX', 10, 220, '2025-01-01', 'contribution');

      const result: SellResult = manager.consumeLots('acc1', 'FXAIX', 15, 250, '2026-06-01');

      // Should consume all 10 from oldest lot ($180) and 5 from middle lot ($200)
      expect(result.lotDetails).toHaveLength(2);
      expect(result.lotDetails[0].costBasisPerShare).toBe(180);
      expect(result.lotDetails[0].shares).toBe(10);
      expect(result.lotDetails[1].costBasisPerShare).toBe(200);
      expect(result.lotDetails[1].shares).toBe(5);
    });

    it('FIFO: partial lot consumption leaves remainder', () => {
      manager.createLot('acc1', 'FXAIX', 10, 200, '2024-01-01', 'contribution');

      manager.consumeLots('acc1', 'FXAIX', 3, 250, '2026-06-01');

      // The lot should have 7 shares remaining
      const state = manager.getAccountState('acc1');
      const lots = state!.lots.filter((l) => l.fundSymbol === 'FXAIX' && l.shares > 0);
      expect(lots).toHaveLength(1);
      expect(lots[0].shares).toBe(7);
    });

    it('highest-cost: sells most expensive lots first', () => {
      // Use a highest-cost config
      const hcConfig = makeFundLevelConfig();
      hcConfig.lotSelectionStrategy = 'highest-cost';
      const hcManager = new PortfolioManager({ acc1: hcConfig });

      hcManager.createLot('acc1', 'FXAIX', 10, 180, '2024-01-01', 'contribution');
      hcManager.createLot('acc1', 'FXAIX', 10, 220, '2024-06-01', 'contribution');
      hcManager.createLot('acc1', 'FXAIX', 10, 200, '2025-01-01', 'contribution');

      const result: SellResult = hcManager.consumeLots('acc1', 'FXAIX', 15, 250, '2026-06-01');

      // Should consume all 10 from most expensive lot ($220) then 5 from next ($200)
      expect(result.lotDetails).toHaveLength(2);
      expect(result.lotDetails[0].costBasisPerShare).toBe(220);
      expect(result.lotDetails[0].shares).toBe(10);
      expect(result.lotDetails[1].costBasisPerShare).toBe(200);
      expect(result.lotDetails[1].shares).toBe(5);
    });

    it('computes gains correctly: (sellPrice - costBasis) * shares', () => {
      manager.createLot('acc1', 'FXAIX', 10, 180, '2024-01-01', 'contribution');

      const result = manager.consumeLots('acc1', 'FXAIX', 10, 250, '2026-06-01');

      expect(result.lotDetails[0].proceeds).toBe(2500); // 10 * 250
      expect(result.lotDetails[0].costBasis).toBe(1800); // 10 * 180
      expect(result.lotDetails[0].gain).toBe(700);       // 2500 - 1800
    });

    it('classifies holding period: > 365 days = long-term', () => {
      // Purchased 2024-01-01, sold 2025-01-02 => 366 days => long-term
      manager.createLot('acc1', 'FXAIX', 10, 200, '2024-01-01', 'contribution');

      const result = manager.consumeLots('acc1', 'FXAIX', 10, 250, '2025-01-02');

      expect(result.lotDetails[0].holdingPeriod).toBe('long');
    });

    it('classifies holding period: <= 365 days = short-term', () => {
      // Purchased 2025-01-01, sold 2026-01-01 => 365 days (non-leap year) => short-term
      manager.createLot('acc1', 'FXAIX', 10, 200, '2025-01-01', 'contribution');

      const result = manager.consumeLots('acc1', 'FXAIX', 10, 250, '2026-01-01');

      expect(result.lotDetails[0].holdingPeriod).toBe('short');
    });

    it('returns SellResult with correct totals', () => {
      manager.createLot('acc1', 'FXAIX', 10, 180, '2024-01-01', 'contribution');
      manager.createLot('acc1', 'FXAIX', 10, 200, '2024-06-01', 'contribution');

      const result = manager.consumeLots('acc1', 'FXAIX', 15, 250, '2026-06-01');

      // lot1: 10 shares @ $180 cost, sold @ $250 => proceeds 2500, basis 1800, gain 700 (long)
      // lot2: 5 shares @ $200 cost, sold @ $250 => proceeds 1250, basis 1000, gain 250 (long)
      expect(result.totalProceeds).toBe(3750);
      expect(result.totalBasis).toBe(2800);
      expect(result.longTermGain).toBe(950);
      expect(result.shortTermGain).toBe(0);
      expect(result.transactions).toHaveLength(2);
    });
  });

  describe('checkpoint/restore with lots and projectedTransactions', () => {
    it('round-trip preserves lots and projectedTransactions', () => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });

      // Create some lots
      manager.createLot('acc1', 'FXAIX', 10, 200, '2024-01-01', 'contribution');
      manager.createLot('acc1', 'FXAIX', 5, 210, '2024-06-01', 'contribution');

      // Sell some to generate projectedTransactions
      manager.consumeLots('acc1', 'FXAIX', 8, 250, '2026-06-01');

      const checkpoint = manager.checkpoint();

      // Create fresh manager and restore
      const manager2 = new PortfolioManager({ acc1: makeFundLevelConfig() });
      manager2.restore(checkpoint);

      // Verify lots preserved
      const state1 = manager.getAccountState('acc1')!;
      const state2 = manager2.getAccountState('acc1')!;

      expect(state2.lots).toHaveLength(state1.lots.length);
      for (let i = 0; i < state1.lots.length; i++) {
        expect(state2.lots[i].id).toBe(state1.lots[i].id);
        expect(state2.lots[i].shares).toBe(state1.lots[i].shares);
        expect(state2.lots[i].costBasisPerShare).toBe(state1.lots[i].costBasisPerShare);
        expect(state2.lots[i].purchaseDate).toBe(state1.lots[i].purchaseDate);
      }

      // Verify projectedTransactions preserved
      expect(state2.projectedTransactions).toHaveLength(state1.projectedTransactions.length);
      for (let i = 0; i < state1.projectedTransactions.length; i++) {
        expect(state2.projectedTransactions[i].id).toBe(state1.projectedTransactions[i].id);
        expect(state2.projectedTransactions[i].type).toBe(state1.projectedTransactions[i].type);
        expect(state2.projectedTransactions[i].shares).toBe(state1.projectedTransactions[i].shares);
      }
    });
  });
});
