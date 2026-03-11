import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadSpendingTrackerCategories, saveSpendingTrackerCategories } from './spendingTracker';
import { load, save, checkExists } from './io';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';

// Project test conventions discovered:
// - Framework: Vitest with vi.mock()
// - Mocking style: vi.mock('./io') then vi.mocked(...).mockReturnValue(...)
// - Assertion library: expect()

vi.mock('./io');

const makeCategory = (overrides: Partial<SpendingTrackerCategory> = {}): SpendingTrackerCategory => ({
  id: 'cat-001',
  name: 'Eating Out',
  threshold: 150,
  thresholdIsVariable: false,
  thresholdVariable: null,
  interval: 'monthly',
  intervalStart: '1',
  accountId: 'acct-001',
  carryOver: false,
  carryUnder: false,
  increaseBy: 0,
  increaseByIsVariable: false,
  increaseByVariable: null,
  increaseByDate: '01/01',
  thresholdChanges: [],
  initializeDate: null,
  ...overrides,
});

describe('spendingTracker IO functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('loadSpendingTrackerCategories', () => {
    it('should return an empty array when the file does not exist', () => {
      vi.mocked(checkExists).mockReturnValue(false);

      const result = loadSpendingTrackerCategories();

      expect(checkExists).toHaveBeenCalledWith('spending-tracker.json');
      expect(load).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    it('should load categories from spending-tracker.json when file exists', () => {
      const mockCategory = makeCategory();
      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockReturnValue({ categories: [mockCategory] });

      const result = loadSpendingTrackerCategories();

      expect(checkExists).toHaveBeenCalledWith('spending-tracker.json');
      expect(load).toHaveBeenCalledWith('spending-tracker.json');
      expect(result).toEqual([mockCategory]);
    });

    it('should return an empty array when file exists but categories array is empty', () => {
      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockReturnValue({ categories: [] });

      const result = loadSpendingTrackerCategories();

      expect(result).toEqual([]);
    });

    it('should return empty array when file exists but categories property is missing', () => {
      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockReturnValue({});

      const result = loadSpendingTrackerCategories();

      expect(result).toEqual([]);
    });

    it('should load multiple categories correctly', () => {
      const cat1 = makeCategory({ id: 'cat-001', name: 'Eating Out' });
      const cat2 = makeCategory({ id: 'cat-002', name: 'Vacation', interval: 'yearly', threshold: 5000 });
      const cat3 = makeCategory({ id: 'cat-003', name: 'Groceries', threshold: 400 });

      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockReturnValue({ categories: [cat1, cat2, cat3] });

      const result = loadSpendingTrackerCategories();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Eating Out');
      expect(result[1].name).toBe('Vacation');
      expect(result[2].name).toBe('Groceries');
    });

    it('should preserve all category fields when loading', () => {
      const category = makeCategory({
        id: 'cat-full',
        name: 'Full Category',
        threshold: 250,
        thresholdIsVariable: true,
        thresholdVariable: 'myThresholdVar',
        interval: 'weekly',
        intervalStart: 'Monday',
        accountId: 'acct-xyz',
        carryOver: true,
        carryUnder: true,
        increaseBy: 0.03,
        increaseByIsVariable: false,
        increaseByVariable: null,
        increaseByDate: '06/15',
        thresholdChanges: [
          {
            date: '2025-01-01',
            dateIsVariable: false,
            dateVariable: null,
            newThreshold: 300,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: true,
          },
        ],
        initializeDate: '2024-01-01',
      });

      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockReturnValue({ categories: [category] });

      const result = loadSpendingTrackerCategories();

      expect(result[0]).toEqual(category);
    });

    it('should propagate errors from the io load function', () => {
      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockImplementation(() => {
        throw new Error('File read error');
      });

      expect(() => loadSpendingTrackerCategories()).toThrow('File read error');
    });
  });

  describe('saveSpendingTrackerCategories', () => {
    it('should save categories to spending-tracker.json wrapped in a data object', () => {
      const categories = [makeCategory()];

      saveSpendingTrackerCategories(categories);

      expect(save).toHaveBeenCalledWith({ categories }, 'spending-tracker.json');
    });

    it('should save an empty categories array', () => {
      saveSpendingTrackerCategories([]);

      expect(save).toHaveBeenCalledWith({ categories: [] }, 'spending-tracker.json');
    });

    it('should save multiple categories', () => {
      const categories = [
        makeCategory({ id: 'cat-001', name: 'Eating Out' }),
        makeCategory({ id: 'cat-002', name: 'Vacation', threshold: 5000 }),
      ];

      saveSpendingTrackerCategories(categories);

      expect(save).toHaveBeenCalledWith({ categories }, 'spending-tracker.json');
    });

    it('should wrap the categories array in a SpendingTrackerData object', () => {
      const categories = [makeCategory({ name: 'Groceries' })];

      saveSpendingTrackerCategories(categories);

      const savedArg = vi.mocked(save).mock.calls[0][0] as { categories: SpendingTrackerCategory[] };
      expect(savedArg).toHaveProperty('categories');
      expect(savedArg.categories).toEqual(categories);
    });

    it('should always write to spending-tracker.json', () => {
      saveSpendingTrackerCategories([makeCategory()]);

      const fileArg = vi.mocked(save).mock.calls[0][1];
      expect(fileArg).toBe('spending-tracker.json');
    });

    it('should propagate errors from the io save function', () => {
      vi.mocked(save).mockImplementation(() => {
        throw new Error('Disk full');
      });

      expect(() => saveSpendingTrackerCategories([makeCategory()])).toThrow('Disk full');
    });

    it('should preserve all fields in each category when saving', () => {
      const category = makeCategory({
        id: 'cat-preserve',
        name: 'Preserve Me',
        threshold: 999,
        thresholdIsVariable: true,
        thresholdVariable: 'myVar',
        interval: 'yearly',
        intervalStart: '04/01',
        accountId: 'acct-preserve',
        carryOver: true,
        carryUnder: false,
        increaseBy: 0.02,
        increaseByIsVariable: true,
        increaseByVariable: 'rateVar',
        increaseByDate: '03/15',
        thresholdChanges: [
          {
            date: '2026-04-01',
            dateIsVariable: true,
            dateVariable: 'startVar',
            newThreshold: 1200,
            newThresholdIsVariable: false,
            newThresholdVariable: null,
            resetCarry: false,
          },
        ],
        initializeDate: '2025-01-01',
      });

      saveSpendingTrackerCategories([category]);

      const savedArg = vi.mocked(save).mock.calls[0][0] as { categories: SpendingTrackerCategory[] };
      expect(savedArg.categories[0]).toEqual(category);
    });
  });

  describe('load and save round-trip', () => {
    it('should save and then be able to load the same categories', () => {
      const categories = [
        makeCategory({ id: 'cat-rt-1', name: 'Round Trip Category' }),
      ];

      // Simulate save
      saveSpendingTrackerCategories(categories);
      const savedData = vi.mocked(save).mock.calls[0][0];

      // Simulate subsequent load
      vi.mocked(checkExists).mockReturnValue(true);
      vi.mocked(load).mockReturnValue(savedData);

      const loaded = loadSpendingTrackerCategories();

      expect(loaded).toEqual(categories);
    });
  });
});
