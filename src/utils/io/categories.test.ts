import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadCategories, saveCategories } from './categories';
import { load, save } from './io';

// Mock the io module
vi.mock('./io');

describe('Categories IO Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadCategories', () => {
    it('should load categories from categories.json', () => {
      const mockCategories = {
        'Housing': ['Rent', 'Utilities', 'Insurance'],
        'Food': ['Groceries', 'Dining', 'Takeout'],
        'Transportation': ['Gas', 'Parking', 'Public Transit'],
        'Entertainment': ['Movies', 'Games', 'Concerts'],
      };

      vi.mocked(load).mockReturnValue(mockCategories);

      const result = loadCategories();

      expect(load).toHaveBeenCalledWith('categories.json');
      expect(result).toEqual(mockCategories);
    });

    it('should handle empty categories file', () => {
      const mockCategories = {};

      vi.mocked(load).mockReturnValue(mockCategories);

      const result = loadCategories();

      expect(load).toHaveBeenCalledWith('categories.json');
      expect(result).toEqual({});
    });

    it('should handle categories with single items', () => {
      const mockCategories = {
        'Miscellaneous': ['Other'],
        'Gifts': ['Birthday'],
      };

      vi.mocked(load).mockReturnValue(mockCategories);

      const result = loadCategories();

      expect(load).toHaveBeenCalledWith('categories.json');
      expect(result).toEqual(mockCategories);
    });

    it('should handle categories with many items', () => {
      const mockCategories = {
        'Shopping': [
          'Clothing',
          'Electronics',
          'Books',
          'Home & Garden',
          'Sports & Outdoors',
          'Health & Beauty',
          'Toys & Games',
          'Office Supplies',
        ],
      };

      vi.mocked(load).mockReturnValue(mockCategories);

      const result = loadCategories();

      expect(load).toHaveBeenCalledWith('categories.json');
      expect(result).toEqual(mockCategories);
    });

    it('should handle categories with special characters', () => {
      const mockCategories = {
        'Health & Fitness': ['Doctor', 'Pharmacy', 'Gym'],
        'Pets & Animals': ['Veterinarian', 'Pet Food', 'Grooming'],
        'Home & Garden': ['Repairs', 'Maintenance', 'Landscaping'],
      };

      vi.mocked(load).mockReturnValue(mockCategories);

      const result = loadCategories();

      expect(load).toHaveBeenCalledWith('categories.json');
      expect(result).toEqual(mockCategories);
    });

    it('should handle categories with empty arrays', () => {
      const mockCategories = {
        'New Category': [],
        'Another Category': ['Item 1', 'Item 2'],
      };

      vi.mocked(load).mockReturnValue(mockCategories);

      const result = loadCategories();

      expect(load).toHaveBeenCalledWith('categories.json');
      expect(result).toEqual(mockCategories);
    });
  });

  describe('saveCategories', () => {
    it('should save categories to categories.json', () => {
      const mockCategories = {
        'Housing': ['Rent', 'Utilities', 'Insurance'],
        'Food': ['Groceries', 'Dining', 'Takeout'],
        'Transportation': ['Gas', 'Parking', 'Public Transit'],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should save empty categories object', () => {
      const mockCategories = {};

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should save categories with single items', () => {
      const mockCategories = {
        'Travel': ['Flight'],
        'Education': ['Books'],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should save categories with many items', () => {
      const mockCategories = {
        'Business': [
          'Office Rent',
          'Equipment',
          'Software',
          'Marketing',
          'Legal',
          'Accounting',
          'Insurance',
          'Supplies',
          'Travel',
          'Training',
        ],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should save categories with special characters', () => {
      const mockCategories = {
        'Health & Wellness': ['Vitamins & Supplements', 'Yoga & Meditation'],
        'Arts & Crafts': ['Painting & Drawing', 'Photography & Video'],
        'Home & Garden': ['Indoor Plants & Flowers', 'Outdoor & Patio'],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should save categories with empty arrays', () => {
      const mockCategories = {
        'Placeholder Category': [],
        'Active Category': ['Item 1', 'Item 2'],
        'Another Empty': [],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should handle categories with numeric-like strings', () => {
      const mockCategories = {
        '2024 Expenses': ['January', 'February', 'March'],
        'Q1 2024': ['Business Travel', 'Office Supplies'],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });

    it('should handle categories with unicode characters', () => {
      const mockCategories = {
        'Café & Restaurant': ['Espresso', 'Pastries'],
        'Naïve Purchases': ['Impulse Buys'],
        'Résumé Building': ['Courses', 'Certifications'],
      };

      saveCategories(mockCategories);

      expect(save).toHaveBeenCalledWith(mockCategories, 'categories.json');
    });
  });

  describe('File Operations Integration', () => {
    it('should handle load and save operations together', () => {
      const initialCategories = {
        'Initial': ['Item 1', 'Item 2'],
      };

      const updatedCategories = {
        'Initial': ['Item 1', 'Item 2'],
        'New': ['Item 3', 'Item 4'],
      };

      // Mock load operation
      vi.mocked(load).mockReturnValue(initialCategories);

      // Load categories
      const loaded = loadCategories();
      expect(loaded).toEqual(initialCategories);

      // Save updated categories
      saveCategories(updatedCategories);
      expect(save).toHaveBeenCalledWith(updatedCategories, 'categories.json');
    });

    it('should handle error scenarios from underlying io operations', () => {
      const mockError = new Error('File not found');
      vi.mocked(load).mockImplementation(() => {
        throw mockError;
      });

      expect(() => loadCategories()).toThrow('File not found');
    });

    it('should handle save error scenarios', () => {
      const mockError = new Error('Permission denied');
      vi.mocked(save).mockImplementation(() => {
        throw mockError;
      });

      const categories = { 'Test': ['Item'] };

      expect(() => saveCategories(categories)).toThrow('Permission denied');
    });
  });
});