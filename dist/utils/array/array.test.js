import { describe, it, expect } from 'vitest';
import { getByIdWithIdx, getById } from './array';
describe('Array utilities', () => {
    const testArray = [
        { id: 'item1', name: 'First Item', value: 10 },
        { id: 'item2', name: 'Second Item', value: 20 },
        { id: 'item3', name: 'Third Item', value: 30 },
    ];
    describe('getByIdWithIdx', () => {
        it('should return item and index when item exists', () => {
            const result = getByIdWithIdx(testArray, 'item2');
            expect(result.item).toEqual({ id: 'item2', name: 'Second Item', value: 20 });
            expect(result.idx).toBe(1);
        });
        it('should return correct index for first item', () => {
            const result = getByIdWithIdx(testArray, 'item1');
            expect(result.item).toEqual({ id: 'item1', name: 'First Item', value: 10 });
            expect(result.idx).toBe(0);
        });
        it('should return correct index for last item', () => {
            const result = getByIdWithIdx(testArray, 'item3');
            expect(result.item).toEqual({ id: 'item3', name: 'Third Item', value: 30 });
            expect(result.idx).toBe(2);
        });
        it('should throw error when item does not exist', () => {
            expect(() => getByIdWithIdx(testArray, 'nonexistent')).toThrow('Item with id nonexistent not found');
        });
        it('should work with empty array', () => {
            expect(() => getByIdWithIdx([], 'any-id')).toThrow('Item with id any-id not found');
        });
        it('should handle arrays with single item', () => {
            const singleItemArray = [{ id: 'only', name: 'Only Item', value: 100 }];
            const result = getByIdWithIdx(singleItemArray, 'only');
            expect(result.item).toEqual({ id: 'only', name: 'Only Item', value: 100 });
            expect(result.idx).toBe(0);
        });
        it('should handle duplicate items correctly (returns first match)', () => {
            const arrayWithDuplicates = [
                { id: 'duplicate', name: 'First Duplicate', value: 1 },
                { id: 'duplicate', name: 'Second Duplicate', value: 2 },
            ];
            const result = getByIdWithIdx(arrayWithDuplicates, 'duplicate');
            expect(result.item).toEqual({ id: 'duplicate', name: 'First Duplicate', value: 1 });
            expect(result.idx).toBe(0);
        });
    });
    describe('getById', () => {
        it('should return item when it exists', () => {
            const result = getById(testArray, 'item2');
            expect(result).toEqual({ id: 'item2', name: 'Second Item', value: 20 });
        });
        it('should return first item correctly', () => {
            const result = getById(testArray, 'item1');
            expect(result).toEqual({ id: 'item1', name: 'First Item', value: 10 });
        });
        it('should return last item correctly', () => {
            const result = getById(testArray, 'item3');
            expect(result).toEqual({ id: 'item3', name: 'Third Item', value: 30 });
        });
        it('should throw error when item does not exist', () => {
            expect(() => getById(testArray, 'nonexistent')).toThrow('Item with id nonexistent not found');
        });
        it('should work with empty array', () => {
            expect(() => getById([], 'any-id')).toThrow('Item with id any-id not found');
        });
        it('should handle arrays with single item', () => {
            const singleItemArray = [{ id: 'only', name: 'Only Item', value: 100 }];
            const result = getById(singleItemArray, 'only');
            expect(result).toEqual({ id: 'only', name: 'Only Item', value: 100 });
        });
        it('should work with different object types', () => {
            const differentArray = [
                { id: 'test1', description: 'Test description', active: true },
                { id: 'test2', description: 'Another description', active: false },
            ];
            const result = getById(differentArray, 'test1');
            expect(result).toEqual({ id: 'test1', description: 'Test description', active: true });
        });
        it('should handle string IDs correctly', () => {
            const stringIdArray = [
                { id: 'abc-123', name: 'Item with string ID', value: 42 },
                { id: 'def-456', name: 'Another item', value: 84 },
            ];
            const result = getById(stringIdArray, 'abc-123');
            expect(result).toEqual({ id: 'abc-123', name: 'Item with string ID', value: 42 });
        });
        it('should handle UUID-like IDs correctly', () => {
            const uuidArray = [
                { id: '550e8400-e29b-41d4-a716-446655440000', name: 'UUID Item 1', value: 1 },
                { id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', name: 'UUID Item 2', value: 2 },
            ];
            const result = getById(uuidArray, '550e8400-e29b-41d4-a716-446655440000');
            expect(result).toEqual({ id: '550e8400-e29b-41d4-a716-446655440000', name: 'UUID Item 1', value: 1 });
        });
    });
});
