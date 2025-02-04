import { DateString } from '../date/types';

// Cached data
export type Cache<T> = Record<CacheKey, T>;
// The key is a string of the start date, end date, and simulation, separated by a dash
export type CacheKey = `${DateString}-${DateString}-${string}`;

// Map of categories to subcategories
export type Categories = Record<string, string[]>;

export type LoadedSimulations = {
	name: string;
	enabled: boolean;
	selected: boolean;
}[];
