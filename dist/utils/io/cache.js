import { formatDate } from '../date/date';
export let CACHE_ACCOUNTS_AND_TRANSFERS = {};
export let MIN_DATE = undefined;
export let MAX_DATE = undefined;
export let RMD_TABLE = {};
export function resetCache() {
    CACHE_ACCOUNTS_AND_TRANSFERS = {};
    MIN_DATE = undefined;
    MAX_DATE = undefined;
    RMD_TABLE = {};
}
export function getCacheKey(startDate, endDate, simulation) {
    return `${formatDate(startDate)}-${formatDate(endDate)}-${simulation}`;
}
export function updateCache(cache, key, data) {
    cache[key] = data;
}
export function getCache(cache, key) {
    return cache[key];
}
export function setMinDate(date) {
    MIN_DATE = date;
}
export function setMaxDate(date) {
    MAX_DATE = date;
}
export function setRMDTable(table) {
    RMD_TABLE = table;
}
