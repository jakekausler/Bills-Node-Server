/**
 * Finds an item by ID in an array and returns both the item and its index
 * @template T - Type extending { id: string }
 * @param array - Array to search in
 * @param id - ID to search for
 * @returns Object containing the found item and its index
 * @throws Error if item with given ID is not found
 */
export function getByIdWithIdx<T extends { id: string }>(array: T[], id: string): { item: T; idx: number } {
  const item = array.find((item) => item.id === id);
  if (!item) {
    throw new Error(`Item with id ${id} not found`);
  }
  return { item, idx: array.indexOf(item) };
}

/**
 * Finds an item by ID in an array
 * @template T - Type extending { id: string }
 * @param array - Array to search in
 * @param id - ID to search for
 * @returns The found item
 * @throws Error if item with given ID is not found
 */
export function getById<T extends { id: string }>(array: T[], id: string): T {
  return getByIdWithIdx(array, id).item;
}
