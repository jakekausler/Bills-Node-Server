import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request } from 'express';
import { getCategories, addCategory, deleteCategory } from './categories';
import { getData } from '../../utils/net/request';
import { loadCategories, saveCategories } from '../../utils/io/categories';

// Mock the dependencies
vi.mock('../../utils/net/request');
vi.mock('../../utils/io/categories');

const mockGetData = vi.mocked(getData);
const mockLoadCategories = vi.mocked(loadCategories);
const mockSaveCategories = vi.mocked(saveCategories);

describe('Categories API', () => {
  const mockRequest = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCategories', () => {
    it('should return categories from loadCategories', () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities', 'Maintenance'],
        Food: ['Groceries', 'Dining'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);

      const result = getCategories(mockRequest);

      expect(result).toEqual(mockCategories);
      expect(mockLoadCategories).toHaveBeenCalledOnce();
    });

    it('should handle empty categories', () => {
      mockLoadCategories.mockReturnValue({});

      const result = getCategories(mockRequest);

      expect(result).toEqual({});
    });
  });

  describe('addCategory', () => {
    it('should add new section when path has one element', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Transportation'] });

      const result = await addCategory(mockRequest);

      expect(result).toEqual({
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
        Transportation: [],
      });
      expect(mockSaveCategories).toHaveBeenCalledWith({
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
        Transportation: [],
      });
    });

    it('should add item to existing section when path has two elements', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Housing', 'Insurance'] });

      const result = await addCategory(mockRequest);

      expect(result.Housing).toContain('Insurance');
      expect(result.Housing).toContain('Rent');
      expect(result.Housing).toContain('Utilities');
      expect(result.Housing.length).toBe(3);
      // Should be sorted alphabetically
      expect(result.Housing).toEqual(['Insurance', 'Rent', 'Utilities']);
    });

    it('should create new section and add item when section does not exist', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Transportation', 'Gas'] });

      const result = await addCategory(mockRequest);

      expect(result).toEqual({
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
        Transportation: ['Gas'],
      });
    });

    it('should deduplicate items when adding duplicate', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Housing', 'Rent'] }); // Rent already exists

      const result = await addCategory(mockRequest);

      // Should deduplicate and maintain only unique items
      expect(result.Housing).toEqual(['Rent', 'Utilities']);
    });

    it('should sort items alphabetically', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Housing', 'Mortgage'] });

      const result = await addCategory(mockRequest);

      // The result should be sorted alphabetically
      expect(result.Housing).toEqual(['Mortgage', 'Rent', 'Utilities']);
    });

    it('should throw error for empty path', async () => {
      mockLoadCategories.mockReturnValue({});
      mockGetData.mockResolvedValue({ path: [] });

      await expect(addCategory(mockRequest)).rejects.toThrow('Invalid path');
      expect(mockSaveCategories).not.toHaveBeenCalled();
    });

    it('should throw error for path with more than 2 elements', async () => {
      mockLoadCategories.mockReturnValue({});
      mockGetData.mockResolvedValue({ path: ['Housing', 'Rent', 'Monthly'] });

      await expect(addCategory(mockRequest)).rejects.toThrow('Invalid path');
      expect(mockSaveCategories).not.toHaveBeenCalled();
    });
  });

  describe('deleteCategory', () => {
    it('should delete entire section when path has one element', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries', 'Dining'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Housing'] });

      const result = await deleteCategory(mockRequest);

      expect(result).toEqual({
        Food: ['Groceries', 'Dining'],
      });
      expect(mockSaveCategories).toHaveBeenCalledWith({
        Food: ['Groceries', 'Dining'],
      });
    });

    it('should delete specific item when path has two elements', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries', 'Dining'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Housing', 'Rent'] });

      const result = await deleteCategory(mockRequest);

      expect(result).toEqual({
        Housing: ['Utilities'],
        Food: ['Groceries', 'Dining'],
      });
      expect(mockSaveCategories).toHaveBeenCalledWith({
        Housing: ['Utilities'],
        Food: ['Groceries', 'Dining'],
      });
    });

    it('should handle deleting non-existent section', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries', 'Dining'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Transportation'] });

      const result = await deleteCategory(mockRequest);

      expect(result).toEqual(mockCategories);
      expect(mockSaveCategories).toHaveBeenCalledWith(mockCategories);
    });

    it('should handle deleting non-existent item', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries', 'Dining'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Housing', 'Insurance'] });

      const result = await deleteCategory(mockRequest);

      expect(result).toEqual(mockCategories);
      expect(mockSaveCategories).toHaveBeenCalledWith(mockCategories);
    });

    it('should handle deleting item from non-existent section', async () => {
      const mockCategories = {
        Housing: ['Rent', 'Utilities'],
        Food: ['Groceries', 'Dining'],
      };

      mockLoadCategories.mockReturnValue(mockCategories);
      mockGetData.mockResolvedValue({ path: ['Transportation', 'Gas'] });

      const result = await deleteCategory(mockRequest);

      expect(result).toEqual(mockCategories);
      expect(mockSaveCategories).toHaveBeenCalledWith(mockCategories);
    });

    it('should throw error for empty path', async () => {
      mockLoadCategories.mockReturnValue({});
      mockGetData.mockResolvedValue({ path: [] });

      await expect(deleteCategory(mockRequest)).rejects.toThrow('Invalid path');
      expect(mockSaveCategories).not.toHaveBeenCalled();
    });

    it('should throw error for path with more than 2 elements', async () => {
      mockLoadCategories.mockReturnValue({});
      mockGetData.mockResolvedValue({ path: ['Housing', 'Rent', 'Monthly'] });

      await expect(deleteCategory(mockRequest)).rejects.toThrow('Invalid path');
      expect(mockSaveCategories).not.toHaveBeenCalled();
    });
  });
});
