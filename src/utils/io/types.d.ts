// Cached data
export type Cache<T> = Record<string, T>;

// Map of categories to subcategories
export type Categories = Record<string, string[]>;

export type LoadedSimulations = {
  name: string;
  enabled: boolean;
  selected: boolean;
}[];
