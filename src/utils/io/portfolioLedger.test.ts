import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadLedger, saveLedger, appendTransactions } from './portfolioLedger';
import * as fs from 'fs';
import { PortfolioTransaction } from '../calculate-v3/portfolio-types';

vi.mock('fs');

const mockTransaction = (overrides: Partial<PortfolioTransaction> = {}): PortfolioTransaction => ({
  id: 'test-id',
  sourceId: 'test-source',
  accountId: 'account-1',
  date: '2025-01-15',
  type: 'buy',
  fundSymbol: 'FXAIX',
  shares: 10,
  pricePerShare: 200,
  totalAmount: 2000,
  fees: 0,
  isProjected: false,
  isEstimated: false,
  ...overrides,
});

describe('portfolioLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadLedger', () => {
    it('should return empty array for empty object', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{}');
      expect(loadLedger()).toEqual([]);
    });

    it('should return array when file contains array', () => {
      const txns = [mockTransaction()];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(txns));
      expect(loadLedger()).toEqual(txns);
    });

    it('should return empty array when file does not exist', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      expect(loadLedger()).toEqual([]);
    });
  });

  describe('saveLedger', () => {
    it('should sort transactions by date before saving', () => {
      const txns = [
        mockTransaction({ date: '2025-03-01', id: 'c' }),
        mockTransaction({ date: '2025-01-01', id: 'a' }),
        mockTransaction({ date: '2025-02-01', id: 'b' }),
      ];
      saveLedger(txns);
      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written[0].date).toBe('2025-01-01');
      expect(written[1].date).toBe('2025-02-01');
      expect(written[2].date).toBe('2025-03-01');
    });
  });

  describe('appendTransactions', () => {
    it('should skip transactions with existing sourceId', () => {
      const existing = [mockTransaction({ sourceId: 'existing-1' })];
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existing));

      const result = appendTransactions([
        mockTransaction({ sourceId: 'existing-1', id: 'dup' }),
        mockTransaction({ sourceId: 'new-1', id: 'new' }),
      ]);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });

    it('should append transactions without sourceId', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('[]');

      const result = appendTransactions([
        mockTransaction({ sourceId: undefined, id: 'no-source' }),
      ]);

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('should sort combined result by date', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify([mockTransaction({ date: '2025-03-01', sourceId: 'a' })]),
      );

      appendTransactions([
        mockTransaction({ date: '2025-01-01', sourceId: 'b' }),
      ]);

      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written[0].date).toBe('2025-01-01');
      expect(written[1].date).toBe('2025-03-01');
    });
  });
});
