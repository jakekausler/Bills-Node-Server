export function getByIdWithIdx<T extends { id: string }>(array: T[], id: string): { item: T; idx: number } {
  const item = array.find((item) => item.id === id);
  if (!item) {
    throw new Error(`Item with id ${id} not found`);
  }
  return { item, idx: array.indexOf(item) };
}

export function getById<T extends { id: string }>(array: T[], id: string): T {
  return getByIdWithIdx(array, id).item;
}
