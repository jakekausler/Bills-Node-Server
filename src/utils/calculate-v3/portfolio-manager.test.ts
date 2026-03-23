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

  describe('executeBuy', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
    });

    it('decreases uninvested cash by amount', () => {
      // Set some uninvested cash first
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;

      manager.executeBuy('acc1', 'FXAIX', 2000, '2026-01-15', 'contribution');

      expect(state.uninvestedCash).toBe(3000);
    });

    it('increases fund position shares by amount / price', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;

      const positionBefore = manager.getPositions('acc1').find((p) => p.symbol === 'FXAIX')!;
      const sharesBefore = positionBefore.shares; // 100

      manager.executeBuy('acc1', 'FXAIX', 2000, '2026-01-15', 'contribution');

      const positionAfter = manager.getPositions('acc1').find((p) => p.symbol === 'FXAIX')!;
      // Price is 200, so 2000/200 = 10 new shares
      expect(positionAfter.shares).toBe(sharesBefore + 10);
    });

    it('creates a lot with correct source', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;

      manager.executeBuy('acc1', 'FXAIX', 2000, '2026-01-15', 'transfer');

      const lots = state.lots.filter((l) => l.fundSymbol === 'FXAIX');
      expect(lots.length).toBeGreaterThanOrEqual(1);
      const lastLot = lots[lots.length - 1];
      expect(lastLot.source).toBe('transfer');
      expect(lastLot.shares).toBe(10); // 2000 / 200
      expect(lastLot.costBasisPerShare).toBe(200);
      expect(lastLot.purchaseDate).toBe('2026-01-15');
    });

    it('updates fund position value', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;

      manager.executeBuy('acc1', 'FXAIX', 2000, '2026-01-15', 'contribution');

      const position = manager.getPositions('acc1').find((p) => p.symbol === 'FXAIX')!;
      // 110 shares * 200 = 22000
      expect(position.value).toBe(22000);
    });

    it('returns a PortfolioTransaction entry with type buy', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;

      const tx = manager.executeBuy('acc1', 'FXAIX', 2000, '2026-01-15', 'contribution');

      expect(tx.type).toBe('buy');
      expect(tx.fundSymbol).toBe('FXAIX');
      expect(tx.shares).toBe(10);
      expect(tx.pricePerShare).toBe(200);
      expect(tx.totalAmount).toBe(2000);
      expect(tx.date).toBe('2026-01-15');
      expect(tx.isProjected).toBe(true);
    });
  });

  describe('executeSell', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
    });

    it('increases uninvested cash by proceeds', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 0;

      // Create lots first via executeBuy
      state.uninvestedCash = 5000;
      manager.executeBuy('acc1', 'FXAIX', 2000, '2024-01-01', 'contribution');
      const cashAfterBuy = state.uninvestedCash; // 3000

      // Sell 5 shares at current price (200)
      manager.executeSell('acc1', 'FXAIX', 5, '2026-06-01');

      // Proceeds = 5 * 200 = 1000
      expect(state.uninvestedCash).toBe(cashAfterBuy + 1000);
    });

    it('decreases fund position shares', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;
      manager.executeBuy('acc1', 'FXAIX', 2000, '2024-01-01', 'contribution');

      const sharesBefore = manager.getPositions('acc1').find((p) => p.symbol === 'FXAIX')!.shares;

      manager.executeSell('acc1', 'FXAIX', 5, '2026-06-01');

      const sharesAfter = manager.getPositions('acc1').find((p) => p.symbol === 'FXAIX')!.shares;
      expect(sharesAfter).toBe(sharesBefore - 5);
    });

    it('consumes lots per strategy (FIFO)', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 10000;

      // Buy at two different times (lots will have price 200 both times since price unchanged)
      manager.executeBuy('acc1', 'FXAIX', 2000, '2024-01-01', 'contribution'); // 10 shares @ 200
      manager.executeBuy('acc1', 'FXAIX', 2000, '2025-01-01', 'contribution'); // 10 shares @ 200

      const result = manager.executeSell('acc1', 'FXAIX', 15, '2026-06-01');

      // FIFO: should consume oldest lot first (all 10), then 5 from next
      expect(result.lotDetails).toHaveLength(2);
      expect(result.lotDetails[0].shares).toBe(10);
      expect(result.lotDetails[1].shares).toBe(5);
    });

    it('returns SellResult with gain/loss details', () => {
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 5000;

      // Buy 10 shares at price 200
      manager.executeBuy('acc1', 'FXAIX', 2000, '2024-01-01', 'contribution');

      // Apply returns to increase price
      manager.applyAnnualReturns('acc1', 2025, simpleReturns);

      // Sell 5 shares at new (higher) price
      const result = manager.executeSell('acc1', 'FXAIX', 5, '2026-06-01');

      expect(result.totalProceeds).toBeGreaterThan(0);
      expect(result.totalBasis).toBeGreaterThan(0);
      // Since price went up, there should be a gain
      expect(result.longTermGain + result.shortTermGain).toBeGreaterThan(0);
      expect(result.lotDetails).toHaveLength(1);
      expect(result.transactions).toHaveLength(1);
    });

    it('edge case: sell when no lots exist returns zero-result', () => {
      // The config starts with 100 shares of FXAIX in positions but no lots
      // executeSell should gracefully handle this (consumeLots returns empty)
      const state = manager.getAccountState('acc1')!;
      state.uninvestedCash = 0;

      const result = manager.executeSell('acc1', 'FXAIX', 5, '2026-06-01');

      expect(result.totalProceeds).toBe(0);
      expect(result.totalBasis).toBe(0);
      expect(result.shortTermGain).toBe(0);
      expect(result.longTermGain).toBe(0);
      expect(result.lotDetails).toHaveLength(0);

      // Position shares should still decrease (shares exist even without lots)
      const position = manager.getPositions('acc1').find((p) => p.symbol === 'FXAIX')!;
      expect(position.shares).toBe(95); // 100 - 5

      // Uninvested cash increases by proceeds (5 * 200 = 1000)
      expect(state.uninvestedCash).toBe(1000);
    });
  });

  describe('executeDeposit', () => {
    describe('with bucket config (reserve below target)', () => {
      let bucketConfig: AccountPortfolioConfig;

      beforeEach(() => {
        bucketConfig = {
          ...makeFundLevelConfig(),
          bucket: {
            reserveAsset: 'SPRXX',
            reserveTarget: 5000,
          },
        };
        manager = new PortfolioManager({ acc1: bucketConfig });
      });

      it('fills reserve first, overflow to investments per weights', () => {
        const state = manager.getAccountState('acc1')!;
        // SPRXX starts at 1000 shares * $1 = $1000, target = $5000, shortfall = $4000
        // Deposit $6000: $4000 to reserve, $2000 split among non-reserve by weight
        state.uninvestedCash = 0;

        const txs = manager.executeDeposit('acc1', 6000, '2026-01-15', 'contribution');

        // Should have at least 3 transactions: 1 reserve buy + 2 non-reserve buys
        expect(txs.length).toBeGreaterThanOrEqual(3);

        // Reserve (SPRXX) buy should be for $4000
        const reserveBuys = txs.filter((t) => t.fundSymbol === 'SPRXX');
        expect(reserveBuys).toHaveLength(1);
        expect(reserveBuys[0].totalAmount).toBeCloseTo(4000, 2);

        // Remaining $2000 split between FXAIX (weight 0.60) and FXNAX (weight 0.30)
        // Normalized: FXAIX = 0.60/0.90 = 2/3, FXNAX = 0.30/0.90 = 1/3
        const fxaixBuys = txs.filter((t) => t.fundSymbol === 'FXAIX');
        expect(fxaixBuys).toHaveLength(1);
        expect(fxaixBuys[0].totalAmount).toBeCloseTo(2000 * (2 / 3), 2);

        const fxnaxBuys = txs.filter((t) => t.fundSymbol === 'FXNAX');
        expect(fxnaxBuys).toHaveLength(1);
        expect(fxnaxBuys[0].totalAmount).toBeCloseTo(2000 * (1 / 3), 2);
      });

      it('deposit smaller than reserve shortfall: all goes to reserve', () => {
        const state = manager.getAccountState('acc1')!;
        // SPRXX at $1000, target $5000, shortfall $4000
        // Deposit $2000 — all to reserve
        state.uninvestedCash = 0;

        const txs = manager.executeDeposit('acc1', 2000, '2026-01-15', 'contribution');

        expect(txs).toHaveLength(1);
        expect(txs[0].fundSymbol).toBe('SPRXX');
        expect(txs[0].totalAmount).toBeCloseTo(2000, 2);
      });
    });

    describe('with bucket config (reserve at/above target)', () => {
      let bucketConfig: AccountPortfolioConfig;

      beforeEach(() => {
        bucketConfig = {
          ...makeFundLevelConfig(),
          bucket: {
            reserveAsset: 'SPRXX',
            reserveTarget: 500, // Target below current value (1000 shares * $1 = $1000)
          },
        };
        manager = new PortfolioManager({ acc1: bucketConfig });
      });

      it('all to investments per weights when reserve at/above target', () => {
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 0;

        const txs = manager.executeDeposit('acc1', 3000, '2026-01-15', 'contribution');

        // No reserve buy needed; all $3000 to non-reserve funds
        const reserveBuys = txs.filter((t) => t.fundSymbol === 'SPRXX');
        expect(reserveBuys).toHaveLength(0);

        // FXAIX: 0.60/(0.60+0.30) = 2/3, FXNAX: 0.30/(0.60+0.30) = 1/3
        const fxaixBuys = txs.filter((t) => t.fundSymbol === 'FXAIX');
        expect(fxaixBuys).toHaveLength(1);
        expect(fxaixBuys[0].totalAmount).toBeCloseTo(3000 * (2 / 3), 2);

        const fxnaxBuys = txs.filter((t) => t.fundSymbol === 'FXNAX');
        expect(fxnaxBuys).toHaveLength(1);
        expect(fxnaxBuys[0].totalAmount).toBeCloseTo(3000 * (1 / 3), 2);
      });
    });

    describe('with no bucket config', () => {
      beforeEach(() => {
        manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
      });

      it('all to investments per contribution weights', () => {
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 0;

        const txs = manager.executeDeposit('acc1', 1000, '2026-01-15', 'contribution');

        // FXAIX: 0.60, FXNAX: 0.30, SPRXX: 0.10 — all have contribution weights
        // Total weight = 1.0, so no normalization needed
        expect(txs).toHaveLength(3);

        const fxaixBuy = txs.find((t) => t.fundSymbol === 'FXAIX')!;
        expect(fxaixBuy.totalAmount).toBeCloseTo(600, 2);

        const fxnaxBuy = txs.find((t) => t.fundSymbol === 'FXNAX')!;
        expect(fxnaxBuy.totalAmount).toBeCloseTo(300, 2);

        const sprxxBuy = txs.find((t) => t.fundSymbol === 'SPRXX')!;
        expect(sprxxBuy.totalAmount).toBeCloseTo(100, 2);
      });
    });

    describe('lot source tracking', () => {
      beforeEach(() => {
        manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
      });

      it('deposit with source contribution creates lots with that source', () => {
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 0;

        manager.executeDeposit('acc1', 1000, '2026-01-15', 'contribution');

        const newLots = state.lots.filter((l) => l.purchaseDate === '2026-01-15');
        expect(newLots.length).toBeGreaterThan(0);
        for (const lot of newLots) {
          expect(lot.source).toBe('contribution');
        }
      });

      it('deposit with source transfer creates lots with that source', () => {
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 0;

        manager.executeDeposit('acc1', 1000, '2026-01-15', 'transfer');

        const newLots = state.lots.filter((l) => l.purchaseDate === '2026-01-15');
        expect(newLots.length).toBeGreaterThan(0);
        for (const lot of newLots) {
          expect(lot.source).toBe('transfer');
        }
      });
    });

    describe('estimated mode deposit', () => {
      beforeEach(() => {
        manager = new PortfolioManager({ acc2: makeEstimatedConfig() });
        manager.initializeEstimatedAccount('acc2', 100000);
      });

      it('distributes per allocation weights (used as contribution weights)', () => {
        const state = manager.getAccountState('acc2')!;
        state.uninvestedCash = 0;

        const txs = manager.executeDeposit('acc2', 10000, '2026-01-15', 'contribution');

        // allocation: stock 0.70, bond 0.20, cash 0.10
        expect(txs).toHaveLength(3);

        const stockBuy = txs.find((t) => t.fundSymbol === 'STOCK')!;
        expect(stockBuy.totalAmount).toBeCloseTo(7000, 2);

        const bondBuy = txs.find((t) => t.fundSymbol === 'BOND')!;
        expect(bondBuy.totalAmount).toBeCloseTo(2000, 2);

        const cashBuy = txs.find((t) => t.fundSymbol === 'CASH')!;
        expect(cashBuy.totalAmount).toBeCloseTo(1000, 2);
      });
    });
  });

  describe('executeWithdrawal', () => {
    describe('with bucket config', () => {
      let bucketConfig: AccountPortfolioConfig;

      beforeEach(() => {
        bucketConfig = {
          ...makeFundLevelConfig(),
          bucket: {
            reserveAsset: 'SPRXX',
            reserveTarget: 5000,
          },
        };
        manager = new PortfolioManager({ acc1: bucketConfig });
        // Create lots so sells have something to consume
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 50000;
        manager.executeBuy('acc1', 'FXAIX', 20000, '2024-01-01', 'contribution');
        manager.executeBuy('acc1', 'FXNAX', 5000, '2024-01-01', 'contribution');
        manager.executeBuy('acc1', 'SPRXX', 5000, '2024-01-01', 'contribution');
      });

      it('draws from reserve first', () => {
        // SPRXX position: 1000 initial + 5000 bought = 6000 shares @ $1 = $6000
        // Withdraw $500 — should all come from reserve
        const result = manager.executeWithdrawal('acc1', 500, '2026-06-01');

        // Only sell transactions should be for SPRXX
        const sellSymbols = result.sellResults.flatMap((sr) =>
          sr.lotDetails.map((ld) => ld.fundSymbol),
        );
        expect(sellSymbols.every((s) => s === 'SPRXX')).toBe(true);
        expect(result.sellResults).toHaveLength(1);
      });

      it('reserve insufficient: sells investments proportionally', () => {
        // SPRXX has 6000 shares @ $1 = $6000
        // Withdraw $8000 — $6000 from reserve, $2000 from other funds proportionally
        const result = manager.executeWithdrawal('acc1', 8000, '2026-06-01');

        // Should have sells from SPRXX plus other funds
        expect(result.sellResults.length).toBeGreaterThan(1);

        // SPRXX should sell $6000 worth
        const sprxxResult = result.sellResults.find((sr) =>
          sr.lotDetails.some((ld) => ld.fundSymbol === 'SPRXX'),
        );
        expect(sprxxResult).toBeDefined();

        // Other funds should sell $2000 total, proportionally by value
        const nonReserveResults = result.sellResults.filter((sr) =>
          sr.lotDetails.some((ld) => ld.fundSymbol !== 'SPRXX'),
        );
        expect(nonReserveResults.length).toBeGreaterThan(0);
      });
    });

    describe('without bucket config', () => {
      beforeEach(() => {
        manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
        // Create lots so sells have something to consume
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 30000;
        manager.executeBuy('acc1', 'FXAIX', 20000, '2024-01-01', 'contribution');
        manager.executeBuy('acc1', 'FXNAX', 5000, '2024-01-01', 'contribution');
        manager.executeBuy('acc1', 'SPRXX', 1000, '2024-01-01', 'contribution');
      });

      it('sells proportionally by value weight across all funds', () => {
        // FXAIX: 100+100=200 shares @ $200 = $40000
        // FXNAX: 50+500=550 shares @ $10 = $5500
        // SPRXX: 1000+1000=2000 shares @ $1 = $2000
        // Total = $47500
        // Withdraw $4750 (10% of total)
        const result = manager.executeWithdrawal('acc1', 4750, '2026-06-01');

        // Should sell from all 3 funds proportionally
        const fundSymbols = new Set(
          result.sellResults.flatMap((sr) => sr.lotDetails.map((ld) => ld.fundSymbol)),
        );
        expect(fundSymbols.size).toBe(3);
      });
    });

    describe('insufficient balance', () => {
      beforeEach(() => {
        manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 2000;
        manager.executeBuy('acc1', 'FXAIX', 2000, '2024-01-01', 'contribution');
      });

      it('sells everything available when withdrawal exceeds balance', () => {
        // FXAIX: 100+10=110 shares @ $200 = $22000
        // FXNAX: 50 shares @ $10 = $500
        // SPRXX: 1000 shares @ $1 = $1000
        // Total = $23500
        // Try to withdraw $50000
        const result = manager.executeWithdrawal('acc1', 50000, '2026-06-01');

        // Should have sell results (sold what was available)
        expect(result.sellResults.length).toBeGreaterThan(0);

        // The total proceeds should be less than 50000 (sold everything)
        const totalProceeds = result.sellResults.reduce((sum, sr) => sum + sr.totalProceeds, 0);
        expect(totalProceeds).toBeLessThan(50000);
        expect(totalProceeds).toBeGreaterThan(0);

        // uninvestedCash must never go negative
        const state = manager.getAccountState('acc1')!;
        expect(state.uninvestedCash).toBeGreaterThanOrEqual(0);
      });
    });

    describe('withdrawal returns correct structure', () => {
      beforeEach(() => {
        manager = new PortfolioManager({ acc1: makeFundLevelConfig() });
        const state = manager.getAccountState('acc1')!;
        state.uninvestedCash = 5000;
        manager.executeBuy('acc1', 'FXAIX', 5000, '2024-01-01', 'contribution');
      });

      it('returns transactions and sellResults with capital gains details', () => {
        // Apply returns to generate gains
        manager.applyAnnualReturns('acc1', 2025, simpleReturns);

        const result = manager.executeWithdrawal('acc1', 1000, '2026-06-01');

        expect(result.transactions).toBeDefined();
        expect(result.sellResults).toBeDefined();
        expect(result.transactions.length).toBeGreaterThan(0);

        // Each sell result should have gain details
        for (const sr of result.sellResults) {
          expect(sr.totalProceeds).toBeDefined();
          expect(sr.totalBasis).toBeDefined();
          expect(sr.shortTermGain).toBeDefined();
          expect(sr.longTermGain).toBeDefined();
        }
      });
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

  describe('executeRothConversion', () => {
    let tradConfig: AccountPortfolioConfig;
    let rothConfig: AccountPortfolioConfig;

    beforeEach(() => {
      tradConfig = makeFundLevelConfig();
      rothConfig = makeFundLevelConfig();
      manager = new PortfolioManager({
        tradIRA: tradConfig,
        rothIRA: rothConfig,
      });

      // Create lots in Traditional IRA so sells work
      const tradState = manager.getAccountState('tradIRA')!;
      tradState.uninvestedCash = 50000;
      manager.executeBuy('tradIRA', 'FXAIX', 30000, '2020-01-01', 'contribution');
      manager.executeBuy('tradIRA', 'FXNAX', 10000, '2020-01-01', 'contribution');
      manager.executeBuy('tradIRA', 'SPRXX', 5000, '2020-01-01', 'contribution');
    });

    it('creates sell in Traditional + buy in Roth', () => {
      const result = manager.executeRothConversion('tradIRA', 'rothIRA', 10000, '2026-12-31');

      expect(result.sellResults.length).toBeGreaterThan(0);
      expect(result.buyTransactions.length).toBeGreaterThan(0);

      // Verify total sell proceeds approximate the conversion amount
      const totalSold = result.sellResults.reduce((sum, sr) => sum + sr.totalProceeds, 0);
      expect(totalSold).toBeGreaterThan(0);

      // Verify buy transactions exist in Roth
      for (const tx of result.buyTransactions) {
        expect(tx.type).toBe('buy');
        expect(tx.source).toBe('conversion');
      }
    });

    it('Roth lots are tagged with source: conversion', () => {
      manager.executeRothConversion('tradIRA', 'rothIRA', 10000, '2026-12-31');

      const rothState = manager.getAccountState('rothIRA')!;
      const conversionLots = rothState.lots.filter((l) => l.source === 'conversion');
      expect(conversionLots.length).toBeGreaterThan(0);
      for (const lot of conversionLots) {
        expect(lot.purchaseDate).toBe('2026-12-31');
      }
    });
  });

  describe('getRothConversionLots', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ rothIRA: makeFundLevelConfig() });
      const state = manager.getAccountState('rothIRA')!;
      state.uninvestedCash = 50000;
    });

    it('returns lots sorted by date (FIFO)', () => {
      // Create conversion lots at different dates
      manager.executeBuy('rothIRA', 'FXAIX', 5000, '2024-12-31', 'conversion');
      manager.executeBuy('rothIRA', 'FXAIX', 3000, '2022-12-31', 'conversion');
      manager.executeBuy('rothIRA', 'FXAIX', 7000, '2023-12-31', 'conversion');
      // Also a contribution lot (should be excluded)
      manager.executeBuy('rothIRA', 'FXNAX', 2000, '2025-01-01', 'contribution');

      const convLots = manager.getRothConversionLots('rothIRA');
      expect(convLots).toHaveLength(3);
      // Sorted by purchaseDate ascending
      expect(convLots[0].purchaseDate).toBe('2022-12-31');
      expect(convLots[1].purchaseDate).toBe('2023-12-31');
      expect(convLots[2].purchaseDate).toBe('2024-12-31');
    });

    it('returns empty array for account with no conversion lots', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 5000, '2024-01-01', 'contribution');
      const convLots = manager.getRothConversionLots('rothIRA');
      expect(convLots).toHaveLength(0);
    });

    it('returns empty array for unknown account', () => {
      const convLots = manager.getRothConversionLots('nonexistent');
      expect(convLots).toHaveLength(0);
    });
  });

  describe('getRothPenaltyFreeBalance', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ rothIRA: makeFundLevelConfig() });
      const state = manager.getAccountState('rothIRA')!;
      state.uninvestedCash = 50000;
    });

    it('conversion > 5 years ago is penalty-free', () => {
      // Conversion from 2019-12-31, checking at 2025-01-01 => ~5.003 years => penalty-free
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2019-12-31', 'conversion');

      const penaltyFree = manager.getRothPenaltyFreeBalance('rothIRA', '2025-01-01');
      expect(penaltyFree).toBeGreaterThan(0);
    });

    it('contributions are always penalty-free', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 5000, '2025-06-01', 'contribution');

      const penaltyFree = manager.getRothPenaltyFreeBalance('rothIRA', '2025-06-15');
      expect(penaltyFree).toBeGreaterThan(0);
    });

    it('recent conversion is NOT penalty-free', () => {
      // Conversion from 2024-12-31, checking at 2025-01-01 => < 5 years
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2024-12-31', 'conversion');

      const penaltyFree = manager.getRothPenaltyFreeBalance('rothIRA', '2025-01-01');
      // Only contributions would be penalty-free, but there are none
      expect(penaltyFree).toBe(0);
    });

    it('conversion exactly 5 years ago is penalty-free', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2020-01-01', 'conversion');
      const penaltyFree = manager.getRothPenaltyFreeBalance('rothIRA', '2025-01-01');
      expect(penaltyFree).toBeGreaterThan(0);
    });
  });

  describe('getRothPenaltyableBalance', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ rothIRA: makeFundLevelConfig() });
      const state = manager.getAccountState('rothIRA')!;
      state.uninvestedCash = 50000;
    });

    it('conversion <= 5 years ago is penaltyable', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2024-06-01', 'conversion');

      const penaltyable = manager.getRothPenaltyableBalance('rothIRA', '2026-01-01');
      expect(penaltyable).toBeGreaterThan(0);
    });

    it('conversion at 4 years 364 days is still penaltyable', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2020-01-02', 'conversion');
      const penaltyable = manager.getRothPenaltyableBalance('rothIRA', '2025-01-01');
      expect(penaltyable).toBeGreaterThan(0);
    });

    it('conversion > 5 years ago is NOT penaltyable', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2019-06-01', 'conversion');

      const penaltyable = manager.getRothPenaltyableBalance('rothIRA', '2025-01-01');
      expect(penaltyable).toBe(0);
    });

    it('contributions are never penaltyable', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 5000, '2025-01-01', 'contribution');

      const penaltyable = manager.getRothPenaltyableBalance('rothIRA', '2025-06-01');
      expect(penaltyable).toBe(0);
    });
  });

  describe('getRothContributionBasis', () => {
    beforeEach(() => {
      manager = new PortfolioManager({ rothIRA: makeFundLevelConfig() });
      const state = manager.getAccountState('rothIRA')!;
      state.uninvestedCash = 50000;
    });

    it('sums only contribution lots', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 5000, '2024-01-01', 'contribution');
      manager.executeBuy('rothIRA', 'FXNAX', 3000, '2024-06-01', 'contribution');
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2024-12-31', 'conversion');

      const basis = manager.getRothContributionBasis('rothIRA');
      expect(basis).toBeCloseTo(8000, 0); // 5000 + 3000 from contributions
    });

    it('returns 0 for account with no contributions', () => {
      manager.executeBuy('rothIRA', 'FXAIX', 10000, '2024-12-31', 'conversion');

      const basis = manager.getRothContributionBasis('rothIRA');
      expect(basis).toBe(0);
    });
  });
});
