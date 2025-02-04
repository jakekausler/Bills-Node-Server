import { Cache, CacheKey } from './types';
import { formatDate } from '../date/date';
import { AccountsAndTransfers } from '../../data/account/types';
import { RMDTableType } from '../calculate/types';

export let CACHE_ACCOUNTS_AND_TRANSFERS: Cache<AccountsAndTransfers> = {};
export let MIN_DATE: Date | undefined = undefined;
export let MAX_DATE: Date | undefined = undefined;
export let RMD_TABLE: RMDTableType = {};

export function resetCache() {
	CACHE_ACCOUNTS_AND_TRANSFERS = {};
	MIN_DATE = undefined;
	MAX_DATE = undefined;
	RMD_TABLE = {};
}

export function getCacheKey(startDate: Date, endDate: Date, simulation: string): CacheKey {
	return `${formatDate(startDate)}-${formatDate(endDate)}-${simulation}`;
}

export function updateCache<T>(cache: Cache<T>, key: CacheKey, data: T) {
	cache[key] = data;
}

export function getCache<T>(cache: Cache<T>, key: CacheKey): T {
	return cache[key];
}

export function setMinDate(date: Date) {
	MIN_DATE = date;
}

export function setMaxDate(date: Date) {
	MAX_DATE = date;
}

export function setRMDTable(table: RMDTableType) {
	RMD_TABLE = table;
}
