import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request } from 'express';

// Mock dependencies before importing modules under test
vi.mock('../../utils/io/spendingTracker');
vi.mock('../../utils/io/io');
vi.mock('../../utils/io/categories');
vi.mock('../../utils/io/cache');
vi.mock('../../utils/calculate-v3/period-utils');
vi.mock('uuid', () => ({ v4: vi.fn(() => 'test-uuid-123') }));
vi.mock('../../utils/net/request');
vi.mock('../../utils/io/minDate');
vi.mock('../../utils/calculate-v3/spending-tracker-manager');

import {
  loadSpendingTrackerCategories,
  saveSpendingTrackerCategories,
} from '../../utils/io/spendingTracker';
import { load } from '../../utils/io/io';
import { loadCategories, saveCategories } from '../../utils/io/categories';
import { resetCache } from '../../utils/io/cache';
import { computePeriodBoundaries } from '../../utils/calculate-v3/period-utils';
import { getData } from '../../utils/net/request';
import { minDate } from '../../utils/io/minDate';
import { SpendingTrackerManager } from '../../utils/calculate-v3/spending-tracker-manager';
import {
  getSpendingTrackerCategories,
  getSpendingTrackerCategory,
  createSpendingTrackerCategory,
  updateSpendingTrackerCategory,
  deleteSpendingTrackerCategory,
  getSpendingTrackerChartData,
  ApiError,
} from './spendingTracker';

const mockLoadSpendingTrackerCategories = vi.mocked(
  loadSpendingTrackerCategories,
);
const mockSaveSpendingTrackerCategories = vi.mocked(
  saveSpendingTrackerCategories,
);
const mockLoad = vi.mocked(load);
const mockLoadCats = vi.mocked(loadCategories);
const mockSaveCats = vi.mocked(saveCategories);
const mockResetCache = vi.mocked(resetCache);
const mockComputePeriodBoundaries = vi.mocked(computePeriodBoundaries);
const mockGetData = vi.mocked(getData);
const mockMinDate = vi.mocked(minDate);
const mockComputeChartData = vi.mocked(SpendingTrackerManager.computeChartData);

const mockRequest = (params = {}, body = {}, query = {}) =>
  ({
    params,
    body,
    query,
  }) as unknown as Request;

const validCategory = {
  id: 'cat-1',
  name: 'Eating Out',
  threshold: 150,
  thresholdIsVariable: false,
  thresholdVariable: null,
  interval: 'weekly' as const,
  intervalStart: 'Saturday',
  accountId: 'account-1',
  carryOver: true,
  carryUnder: true,
  increaseBy: 0.03,
  increaseByIsVariable: false,
  increaseByVariable: null,
  increaseByDate: '01/01',
  thresholdChanges: [],
  initializeDate: null,
};

const validCategory2 = {
  ...validCategory,
  id: 'cat-2',
  name: 'Vacation',
};

describe('Spending Tracker API', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks for account validation
    mockLoad.mockReturnValue({
      accounts: [
        { id: 'account-1', name: 'Checking' },
        { id: 'account-2', name: 'Savings' },
      ],
      transfers: { activity: [], bills: [] },
    } as any);

    // Default categories mock
    mockLoadCats.mockReturnValue({ 'Spending Tracker': [] });
  });

  describe('CRUD operations', () => {
    describe('getSpendingTrackerCategories', () => {
      it('returns all categories', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          validCategory,
          validCategory2,
        ]);

        const result = getSpendingTrackerCategories(mockRequest());

        expect(result).toEqual([validCategory, validCategory2]);
        expect(mockLoadSpendingTrackerCategories).toHaveBeenCalledOnce();
      });

      it('returns empty array when no categories exist', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);

        const result = getSpendingTrackerCategories(mockRequest());

        expect(result).toEqual([]);
      });
    });

    describe('getSpendingTrackerCategory', () => {
      it('returns category by id', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          validCategory,
          validCategory2,
        ]);

        const result = getSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }),
        );

        expect(result).toEqual(validCategory);
      });

      it('throws 404 when category not found', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

        try {
          getSpendingTrackerCategory(mockRequest({ id: 'nonexistent' }));
          expect.fail('Should have thrown');
        } catch (e: any) {
          expect(e).toBeInstanceOf(ApiError);
          expect(e.statusCode).toBe(404);
          expect(e.message).toBe('Spending tracker category not found');
        }
      });
    });

    describe('createSpendingTrackerCategory', () => {
      const createBody = {
        name: 'Eating Out',
        threshold: 150,
        thresholdIsVariable: false,
        thresholdVariable: null,
        interval: 'weekly',
        intervalStart: 'Saturday',
        accountId: 'account-1',
        carryOver: true,
        carryUnder: true,
        increaseBy: 0.03,
        increaseByIsVariable: false,
        increaseByVariable: null,
        increaseByDate: '01/01',
        thresholdChanges: [],
      };

      it('creates category with generated UUID', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);

        const result = createSpendingTrackerCategory(
          mockRequest({}, createBody),
        );

        expect(result.id).toBe('test-uuid-123');
      });

      it('saves to spending tracker file', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);

        createSpendingTrackerCategory(mockRequest({}, createBody));

        expect(mockSaveSpendingTrackerCategories).toHaveBeenCalledOnce();
        const savedCategories =
          mockSaveSpendingTrackerCategories.mock.calls[0][0];
        expect(savedCategories).toHaveLength(1);
        expect(savedCategories[0].id).toBe('test-uuid-123');
        expect(savedCategories[0].name).toBe('Eating Out');
      });

      it('updates categories.json with new name', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);

        createSpendingTrackerCategory(mockRequest({}, createBody));

        expect(mockSaveCats).toHaveBeenCalledOnce();
        const savedCats = mockSaveCats.mock.calls[0][0];
        expect(savedCats['Spending Tracker']).toContain('Eating Out');
      });

      it('creates Spending Tracker key in categories.json if missing', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);
        mockLoadCats.mockReturnValue({});

        createSpendingTrackerCategory(mockRequest({}, createBody));

        const savedCats = mockSaveCats.mock.calls[0][0];
        expect(savedCats['Spending Tracker']).toEqual(['Eating Out']);
      });

      it('clears cache after creation', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);

        createSpendingTrackerCategory(mockRequest({}, createBody));

        expect(mockResetCache).toHaveBeenCalledOnce();
      });

      it('returns the new category', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([]);

        const result = createSpendingTrackerCategory(
          mockRequest({}, createBody),
        );

        expect(result).toEqual({
          id: 'test-uuid-123',
          name: 'Eating Out',
          threshold: 150,
          thresholdIsVariable: false,
          thresholdVariable: null,
          interval: 'weekly',
          intervalStart: 'Saturday',
          accountId: 'account-1',
          carryOver: true,
          carryUnder: true,
          increaseBy: 0.03,
          increaseByIsVariable: false,
          increaseByVariable: null,
          increaseByDate: '01/01',
          thresholdChanges: [],
          initializeDate: null,
        });
      });
    });

    describe('updateSpendingTrackerCategory', () => {
      const updateBody = {
        name: 'Eating Out Updated',
        threshold: 200,
        thresholdIsVariable: false,
        thresholdVariable: null,
        interval: 'weekly',
        intervalStart: 'Sunday',
        accountId: 'account-1',
        carryOver: false,
        carryUnder: false,
        increaseBy: 0.05,
        increaseByIsVariable: false,
        increaseByVariable: null,
        increaseByDate: '01/01',
        thresholdChanges: [],
      };

      it('updates existing category', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);

        const result = updateSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }, updateBody),
        );

        expect(result.name).toBe('Eating Out Updated');
        expect(result.threshold).toBe(200);
        expect(result.id).toBe('cat-1');
        expect(mockSaveSpendingTrackerCategories).toHaveBeenCalledOnce();
      });

      it('creates Spending Tracker key in categories.json if missing during name change', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);
        mockLoadCats.mockReturnValue({});

        updateSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }, updateBody),
        );

        expect(mockSaveCats).toHaveBeenCalledOnce();
        const savedCats = mockSaveCats.mock.calls[0][0];
        expect(savedCats['Spending Tracker']).toEqual(['Eating Out Updated']);
      });

      it('throws 400 when validation fails on update', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);

        try {
          updateSpendingTrackerCategory(
            mockRequest(
              { id: 'cat-1' },
              { ...updateBody, threshold: -1 },
            ),
          );
          expect.fail('Should have thrown');
        } catch (e: any) {
          expect(e).toBeInstanceOf(ApiError);
          expect(e.statusCode).toBe(400);
          expect(e.message).toContain('Threshold must be >= 0');
        }
      });

      it('updates categories.json when name changes', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);
        mockLoadCats.mockReturnValue({
          'Spending Tracker': ['Eating Out'],
        });

        updateSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }, updateBody),
        );

        expect(mockSaveCats).toHaveBeenCalledOnce();
        const savedCats = mockSaveCats.mock.calls[0][0];
        expect(savedCats['Spending Tracker']).not.toContain('Eating Out');
        expect(savedCats['Spending Tracker']).toContain('Eating Out Updated');
      });

      it('does not update categories.json when name unchanged', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);

        const sameNameBody = { ...updateBody, name: 'Eating Out' };
        updateSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }, sameNameBody),
        );

        expect(mockSaveCats).not.toHaveBeenCalled();
      });

      it('clears cache after update', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);

        updateSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }, updateBody),
        );

        expect(mockResetCache).toHaveBeenCalledOnce();
      });

      it('throws 404 when category not found', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

        try {
          updateSpendingTrackerCategory(
            mockRequest({ id: 'nonexistent' }, updateBody),
          );
          expect.fail('Should have thrown');
        } catch (e: any) {
          expect(e).toBeInstanceOf(ApiError);
          expect(e.statusCode).toBe(404);
          expect(e.message).toBe('Spending tracker category not found');
        }
      });
    });

    describe('deleteSpendingTrackerCategory', () => {
      it('deletes existing category', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
          { ...validCategory2 },
        ]);
        mockLoadCats.mockReturnValue({
          'Spending Tracker': ['Eating Out', 'Vacation'],
        });

        deleteSpendingTrackerCategory(mockRequest({ id: 'cat-1' }));

        expect(mockSaveSpendingTrackerCategories).toHaveBeenCalledOnce();
        const savedCategories =
          mockSaveSpendingTrackerCategories.mock.calls[0][0];
        expect(savedCategories).toHaveLength(1);
        expect(savedCategories[0].id).toBe('cat-2');
      });

      it('removes name from categories.json', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
          { ...validCategory2 },
        ]);
        mockLoadCats.mockReturnValue({
          'Spending Tracker': ['Eating Out', 'Vacation'],
        });

        deleteSpendingTrackerCategory(mockRequest({ id: 'cat-1' }));

        expect(mockSaveCats).toHaveBeenCalledOnce();
        const savedCats = mockSaveCats.mock.calls[0][0];
        expect(savedCats['Spending Tracker']).not.toContain('Eating Out');
        expect(savedCats['Spending Tracker']).toContain('Vacation');
      });

      it('keeps Spending Tracker key even when last category deleted', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);
        mockLoadCats.mockReturnValue({
          'Spending Tracker': ['Eating Out'],
        });

        deleteSpendingTrackerCategory(mockRequest({ id: 'cat-1' }));

        const savedCats = mockSaveCats.mock.calls[0][0];
        expect(savedCats).toHaveProperty('Spending Tracker');
        expect(savedCats['Spending Tracker']).toEqual([]);
      });

      it('clears cache after deletion', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);
        mockLoadCats.mockReturnValue({
          'Spending Tracker': ['Eating Out'],
        });

        deleteSpendingTrackerCategory(mockRequest({ id: 'cat-1' }));

        expect(mockResetCache).toHaveBeenCalledOnce();
      });

      it('throws 404 when category not found', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

        try {
          deleteSpendingTrackerCategory(mockRequest({ id: 'nonexistent' }));
          expect.fail('Should have thrown');
        } catch (e: any) {
          expect(e).toBeInstanceOf(ApiError);
          expect(e.statusCode).toBe(404);
          expect(e.message).toBe('Spending tracker category not found');
        }
      });

      it('returns { success: true }', () => {
        mockLoadSpendingTrackerCategories.mockReturnValue([
          { ...validCategory },
        ]);
        mockLoadCats.mockReturnValue({
          'Spending Tracker': ['Eating Out'],
        });

        const result = deleteSpendingTrackerCategory(
          mockRequest({ id: 'cat-1' }),
        );

        expect(result).toEqual({ success: true });
      });
    });
  });

  describe('getSpendingTrackerChartData', () => {
    const mockChartResponse = {
      data: [{ date: '2024-01-01', spent: 100, threshold: 150, carry: 0 }],
      summary: { total: 100, average: 100, periodsOver: 0, periodsUnder: 1 },
    };

    const mockAccountsAndTransfers = {
      accounts: [
        {
          id: 'account-1',
          consolidatedActivity: [
            { id: 'act-1', date: '2024-01-15', amount: -50, name: 'Lunch' },
          ],
        },
      ],
      transfers: { activity: [], bills: [] },
    };

    const mockEngineData = {
      simulation: 'Default',
      accountsAndTransfers: mockAccountsAndTransfers,
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
    };

    beforeEach(() => {
      mockGetData.mockResolvedValue(mockEngineData as any);
      mockMinDate.mockReturnValue(new Date('2024-01-01'));
      mockComputeChartData.mockReturnValue(mockChartResponse as any);
    });

    it('throws 404 when category not found', async () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

      await expect(
        getSpendingTrackerChartData(mockRequest({ id: 'nonexistent' }, {}, { startDate: '2024-01-01', endDate: '2024-12-31' })),
      ).rejects.toMatchObject({
        statusCode: 404,
        message: 'Spending tracker category not found',
      });
    });

    it('throws 400 when startDate is missing', async () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

      await expect(
        getSpendingTrackerChartData(mockRequest({ id: 'cat-1' }, {}, { endDate: '2024-12-31' })),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'startDate and endDate query parameters are required',
      });
    });

    it('throws 400 when endDate is missing', async () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

      await expect(
        getSpendingTrackerChartData(mockRequest({ id: 'cat-1' }, {}, { startDate: '2024-01-01' })),
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'startDate and endDate query parameters are required',
      });
    });

    it('returns chart data from SpendingTrackerManager', async () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

      const result = await getSpendingTrackerChartData(
        mockRequest({ id: 'cat-1' }, {}, { startDate: '2024-01-01', endDate: '2024-12-31' }),
      );

      expect(result).toBe(mockChartResponse);
    });

    it('calls SpendingTrackerManager.computeChartData with correct arguments', async () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);
      mockMinDate.mockReturnValue(new Date('2024-01-01'));

      await getSpendingTrackerChartData(
        mockRequest({ id: 'cat-1' }, {}, { startDate: '2024-03-01', endDate: '2024-09-30' }),
      );

      expect(mockComputeChartData).toHaveBeenCalledOnce();
      const callArgs = mockComputeChartData.mock.calls[0];
      expect(callArgs[0]).toEqual(validCategory);
      expect(callArgs[2]).toEqual({ startDate: '2024-03-01', endDate: '2024-09-30' });
      expect(callArgs[3]).toBe('2024-01-01');
    });

    it('collects consolidated activities from all accounts', async () => {
      const multiAccountData = {
        ...mockEngineData,
        accountsAndTransfers: {
          accounts: [
            {
              id: 'account-1',
              consolidatedActivity: [
                { id: 'act-1', date: '2024-01-15', amount: -50, name: 'Lunch' },
              ],
            },
            {
              id: 'account-2',
              consolidatedActivity: [
                { id: 'act-2', date: '2024-02-10', amount: -75, name: 'Dinner' },
              ],
            },
          ],
          transfers: { activity: [], bills: [] },
        },
      };
      mockGetData.mockResolvedValue(multiAccountData as any);
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

      await getSpendingTrackerChartData(
        mockRequest({ id: 'cat-1' }, {}, { startDate: '2024-01-01', endDate: '2024-12-31' }),
      );

      const allActivitiesArg = mockComputeChartData.mock.calls[0][1];
      expect(allActivitiesArg).toHaveLength(2);
      expect(allActivitiesArg[0].id).toBe('act-1');
      expect(allActivitiesArg[1].id).toBe('act-2');
    });

    it('uses category initializeDate when set', async () => {
      const categoryWithInitDate = { ...validCategory, initializeDate: '2023-06-01' };
      mockLoadSpendingTrackerCategories.mockReturnValue([categoryWithInitDate]);

      await getSpendingTrackerChartData(
        mockRequest({ id: 'cat-1' }, {}, { startDate: '2024-01-01', endDate: '2024-12-31' }),
      );

      const initializeDateArg = mockComputeChartData.mock.calls[0][5];
      expect(initializeDateArg).toBe('2023-06-01');
    });

    it('falls back to calculationStartDate when initializeDate is null', async () => {
      const categoryWithNoInitDate = { ...validCategory, initializeDate: null };
      mockLoadSpendingTrackerCategories.mockReturnValue([categoryWithNoInitDate]);
      mockMinDate.mockReturnValue(new Date('2022-03-15'));

      await getSpendingTrackerChartData(
        mockRequest({ id: 'cat-1' }, {}, { startDate: '2024-01-01', endDate: '2024-12-31' }),
      );

      const initializeDateArg = mockComputeChartData.mock.calls[0][5];
      expect(initializeDateArg).toBe('2022-03-15');
    });
  });

  describe('Validation', () => {
    // Helper: valid body for creation
    const validBody = {
      name: 'New Category',
      threshold: 100,
      thresholdIsVariable: false,
      thresholdVariable: null,
      interval: 'weekly',
      intervalStart: 'Monday',
      accountId: 'account-1',
      carryOver: false,
      carryUnder: false,
      increaseBy: 0,
      increaseByIsVariable: false,
      increaseByVariable: null,
      increaseByDate: '01/01',
      thresholdChanges: [],
    };

    it('rejects empty name', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, name: '' }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain('Name is required');
      }
    });

    it('rejects duplicate name', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([validCategory]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, name: 'Eating Out' }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain('Category name must be unique');
      }
    });

    it('allows same name on update (same id)', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([
        { ...validCategory },
      ]);

      // Update cat-1 keeping the same name "Eating Out"
      const result = updateSpendingTrackerCategory(
        mockRequest(
          { id: 'cat-1' },
          { ...validBody, name: 'Eating Out' },
        ),
      );

      expect(result.name).toBe('Eating Out');
    });

    it('rejects negative threshold', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, threshold: -10 }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain('Threshold must be >= 0');
      }
    });

    it('rejects missing threshold (undefined)', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, threshold: undefined }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain('Threshold is required');
      }
    });

    it('rejects invalid interval value', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, interval: 'biweekly' }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Interval must be one of: weekly, monthly, yearly',
        );
      }
    });

    it('rejects invalid monthly intervalStart (> 28)', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest(
            {},
            { ...validBody, interval: 'monthly', intervalStart: '29' },
          ),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Monthly interval start must be between 1 and 28',
        );
      }
    });

    it('rejects invalid monthly intervalStart (< 1)', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest(
            {},
            { ...validBody, interval: 'monthly', intervalStart: '0' },
          ),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Monthly interval start must be between 1 and 28',
        );
      }
    });

    it('rejects missing accountId', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, accountId: '' }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain('Account ID is required');
      }
    });

    it('rejects non-existent accountId', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest({}, { ...validBody, accountId: 'nonexistent-account' }),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Account ID does not reference an existing account',
        );
      }
    });

    it('rejects unsorted thresholdChanges', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      const unsortedChanges = [
        {
          date: '2026-06-01',
          dateIsVariable: false,
          dateVariable: null,
          newThreshold: 200,
          newThresholdIsVariable: false,
          newThresholdVariable: null,
          resetCarry: false,
        },
        {
          date: '2026-03-01',
          dateIsVariable: false,
          dateVariable: null,
          newThreshold: 175,
          newThresholdIsVariable: false,
          newThresholdVariable: null,
          resetCarry: false,
        },
      ];

      try {
        createSpendingTrackerCategory(
          mockRequest(
            {},
            { ...validBody, thresholdChanges: unsortedChanges },
          ),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Threshold changes must be sorted chronologically with no duplicate dates',
        );
      }
    });

    it('rejects duplicate thresholdChanges dates', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      const duplicateDateChanges = [
        {
          date: '2026-03-01',
          dateIsVariable: false,
          dateVariable: null,
          newThreshold: 175,
          newThresholdIsVariable: false,
          newThresholdVariable: null,
          resetCarry: false,
        },
        {
          date: '2026-03-01',
          dateIsVariable: false,
          dateVariable: null,
          newThreshold: 200,
          newThresholdIsVariable: false,
          newThresholdVariable: null,
          resetCarry: false,
        },
      ];

      try {
        createSpendingTrackerCategory(
          mockRequest(
            {},
            { ...validBody, thresholdChanges: duplicateDateChanges },
          ),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Threshold changes must be sorted chronologically with no duplicate dates',
        );
      }
    });

    it('rejects negative thresholdChanges newThreshold', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      const negativeThresholdChanges = [
        {
          date: '2026-03-01',
          dateIsVariable: false,
          dateVariable: null,
          newThreshold: -50,
          newThresholdIsVariable: false,
          newThresholdVariable: null,
          resetCarry: false,
        },
      ];

      try {
        createSpendingTrackerCategory(
          mockRequest(
            {},
            { ...validBody, thresholdChanges: negativeThresholdChanges },
          ),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        expect(e.message).toContain(
          'Threshold change newThreshold must be >= 0',
        );
      }
    });

    it('returns multiple validation errors at once', () => {
      mockLoadSpendingTrackerCategories.mockReturnValue([]);

      try {
        createSpendingTrackerCategory(
          mockRequest(
            {},
            {
              ...validBody,
              name: '',
              threshold: -5,
              interval: 'invalid',
              accountId: '',
            },
          ),
        );
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ApiError);
        expect(e.statusCode).toBe(400);
        // Errors are joined with '; '
        const errors = e.message.split('; ');
        expect(errors.length).toBeGreaterThanOrEqual(3);
        expect(e.message).toContain('Name is required');
        expect(e.message).toContain('Threshold must be >= 0');
        expect(e.message).toContain(
          'Interval must be one of: weekly, monthly, yearly',
        );
        expect(e.message).toContain('Account ID is required');
      }
    });
  });
});
