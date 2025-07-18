import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatDate, getMinDate, isSame } from '../date/date';
import { endTiming, startTiming } from '../log';
dayjs.extend(utc);
/** Maximum number of days to show detailed activity graph before switching to yearly view */
const MAX_DAYS_FOR_ACTIVITY = 365 * 10;
/**
 * Determines whether to load a detailed activity graph or yearly summary based on date range
 * @param accountsAndTransfers - Complete financial data structure
 * @param startDate - Start date for graph data
 * @param endDate - End date for graph data
 * @returns Graph data optimized for the date range (yearly for large ranges, daily for smaller ranges)
 */
export function loadGraph(accountsAndTransfers, startDate, endDate) {
    const minDate = getMinDate(accountsAndTransfers);
    const daySpan = (endDate.getTime() - Math.max(startDate.getTime(), minDate.getTime())) / (1000 * 60 * 60 * 24);
    if (daySpan > MAX_DAYS_FOR_ACTIVITY) {
        return loadYearlyGraph(accountsAndTransfers, startDate, endDate, minDate);
    }
    else {
        return loadActivityGraph(accountsAndTransfers, startDate, endDate, minDate);
    }
}
/**
 * Initializes tracking data structures for yearly graph processing
 * @param accounts - Array of account objects
 * @returns Initialized balance maps and year balance tracking
 */
function initializeYearlyGraphData(accounts) {
    const yearBalance = {};
    const balanceMap = {};
    const idxMap = {};
    for (const acc of accounts) {
        balanceMap[acc.id] = 0;
        idxMap[acc.id] = 0;
        yearBalance[acc.id] = {};
    }
    return { yearBalance, balanceMap, idxMap };
}
/**
 * Processes activities for a specific account on a given date
 * @param account - Account to process
 * @param currDate - Current date being processed
 * @param idxMap - Index mapping for activity tracking
 * @returns Array of balance values for activities on this date
 */
function processAccountActivitiesForDate(account, currDate, idxMap) {
    const activity = [];
    while (idxMap[account.id] < account.consolidatedActivity.length &&
        isSame(account.consolidatedActivity[idxMap[account.id]].date, currDate)) {
        activity.push(account.consolidatedActivity[idxMap[account.id]].balance);
        idxMap[account.id]++;
    }
    return activity;
}
/**
 * Updates year balance tracking with new activity data
 * @param yearBalance - Year balance tracking object
 * @param accountId - ID of the account to update
 * @param currentYear - Current year being processed
 * @param finalBalance - Final balance from activities
 */
function updateYearBalance(yearBalance, accountId, currentYear, finalBalance) {
    if (yearBalance[accountId][currentYear] === null) {
        yearBalance[accountId][currentYear] = [finalBalance, finalBalance];
    }
    else {
        const currentMinMax = yearBalance[accountId][currentYear];
        yearBalance[accountId][currentYear] = [
            Math.min(currentMinMax[0], finalBalance),
            Math.max(currentMinMax[1], finalBalance),
        ];
    }
}
/**
 * Initializes a new year in the tracking data
 * @param currDate - Current date
 * @param currentYear - Previous year value
 * @param labels - Labels array to update
 * @param yearBalance - Year balance tracking to update
 * @param accounts - Array of accounts
 * @returns New current year
 */
function initializeNewYear(currDate, currentYear, labels, yearBalance, accounts) {
    const newYear = currDate.getFullYear();
    if (newYear !== currentYear) {
        labels.push(formatDate(currDate));
        for (const acc of accounts) {
            yearBalance[acc.id][newYear] = null;
        }
        return newYear;
    }
    return currentYear;
}
/**
 * Generates yearly graph data showing account balance trends over years
 * @param accountsAndTransfers - Complete financial data structure
 * @param startDate - Start date for graph data
 * @param endDate - End date for graph data
 * @param minDate - Minimum date from all account data
 * @returns Yearly graph data with min/max balances per year
 */
export function loadYearlyGraph(accountsAndTransfers, startDate, endDate, minDate) {
    startTiming('loadYearlyGraph');
    const labels = [];
    let currDate = minDate;
    let currentYear = 0;
    const { yearBalance, idxMap } = initializeYearlyGraphData(accountsAndTransfers.accounts);
    while (currDate.getTime() <= endDate.getTime()) {
        if (currDate.getTime() < startDate.getTime()) {
            currDate = dayjs.utc(currDate).add(1, 'day').toDate();
            continue;
        }
        currentYear = initializeNewYear(currDate, currentYear, labels, yearBalance, accountsAndTransfers.accounts);
        // Process each account for the current date
        for (const acc of accountsAndTransfers.accounts) {
            const activities = processAccountActivitiesForDate(acc, currDate, idxMap);
            if (activities.length > 0) {
                const finalBalance = activities[activities.length - 1];
                updateYearBalance(yearBalance, acc.id, currentYear, finalBalance);
            }
        }
        currDate = dayjs.utc(currDate).add(1, 'day').toDate();
    }
    // Build datasets with minimum balances for each year
    const datasets = accountsAndTransfers.accounts.map(acc => ({
        label: acc.name,
        data: Object.values(yearBalance[acc.id]).map((year) => (year ? year[0] : 0)),
    }));
    endTiming('loadYearlyGraph');
    return { type: 'yearly', labels, datasets };
}
/**
 * Initializes data structures for activity graph processing
 * @param accounts - Array of account objects
 * @returns Initialized tracking maps and datasets
 */
function initializeActivityGraphData(accounts) {
    const datasets = accounts.map((acc) => ({
        label: acc.name,
        data: [],
        activity: [],
    }));
    const idxMap = {};
    const balanceMap = {};
    for (const acc of accounts) {
        idxMap[acc.id] = 0;
        balanceMap[acc.id] = 0;
    }
    return { datasets, idxMap, balanceMap };
}
/**
 * Processes activities for an account on a specific date for detailed activity tracking
 * @param account - Account to process
 * @param currDate - Current date
 * @param idxMap - Index tracking map
 * @param balanceMap - Balance tracking map
 * @returns Activities for this date with name and amount
 */
function processAccountActivitiesForActivityGraph(account, currDate, idxMap, balanceMap) {
    const activity = [];
    while (idxMap[account.id] < account.consolidatedActivity.length &&
        isSame(account.consolidatedActivity[idxMap[account.id]].date, currDate)) {
        const currentActivity = account.consolidatedActivity[idxMap[account.id]];
        activity.push({
            name: currentActivity.name,
            amount: currentActivity.amount,
        });
        balanceMap[account.id] = Math.round(currentActivity.balance * 100) / 100;
        idxMap[account.id]++;
    }
    return activity;
}
/**
 * Removes empty days from the graph data to reduce noise
 * @param labels - Date labels array
 * @param datasets - Activity datasets array
 */
function removeEmptyDays(labels, datasets) {
    // Find empty days to remove (excluding first and last day)
    const toRemove = [];
    for (let i = 0; i < labels.length; i++) {
        if (i > 0 && i < labels.length - 1 && datasets[0].activity[i].length === 0) {
            toRemove.push(i);
        }
    }
    // Remove empty days in reverse order to maintain indices
    for (let i = toRemove.length - 1; i >= 0; i--) {
        labels.splice(toRemove[i], 1);
        for (const dataset of datasets) {
            dataset.data.splice(toRemove[i], 1);
            dataset.activity.splice(toRemove[i], 1);
        }
    }
    // Remove the first day if it's empty and there are other days
    if (labels.length > 1 && datasets[0].activity[0].length === 0) {
        labels.shift();
        for (const dataset of datasets) {
            dataset.data.shift();
            dataset.activity.shift();
        }
    }
}
/**
 * Generates detailed activity graph data showing daily activities and balances
 * @param accountsAndTransfers - Complete financial data structure
 * @param startDate - Start date for graph data
 * @param endDate - End date for graph data
 * @param minDate - Minimum date from all account data
 * @returns Activity graph data with daily granularity
 */
function loadActivityGraph(accountsAndTransfers, startDate, endDate, minDate) {
    let labels = [];
    let currDate = minDate;
    const { datasets, idxMap, balanceMap } = initializeActivityGraphData(accountsAndTransfers.accounts);
    while (currDate.getTime() <= endDate.getTime()) {
        if (currDate.getTime() < startDate.getTime()) {
            currDate = dayjs.utc(currDate).add(1, 'day').toDate();
            continue;
        }
        labels.push(formatDate(currDate));
        // Process each account for the current date
        accountsAndTransfers.accounts.forEach((acc, index) => {
            const activity = processAccountActivitiesForActivityGraph(acc, currDate, idxMap, balanceMap);
            datasets[index].data.push(balanceMap[acc.id]);
            datasets[index].activity.push(activity);
        });
        currDate = dayjs.utc(currDate).add(1, 'day').toDate();
    }
    removeEmptyDays(labels, datasets);
    return { type: 'activity', labels, datasets };
}
