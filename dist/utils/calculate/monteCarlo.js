import fs from 'fs';
import { Account } from '../../data/account/account';
import { Activity } from '../../data/activity/activity';
import { Bill } from '../../data/bill/bill';
import { calculateAllActivity } from './calculate';
import { loadYearlyGraph } from '../graph/graph';
import { getMinDate, parseDate } from '../date/date';
import { endTiming, startTiming } from '../log';
import { BASE_DATA_DIR, load } from '../io/io';
import { save } from '../io/io';
import { v4 as uuidv4 } from 'uuid';
function cloneAccountsAndTransfers(accountsAndTransfers) {
    startTiming('cloneAccountsAndTransfers');
    const clone = {
        accounts: accountsAndTransfers.accounts.map((account) => new Account(account.serialize())),
        transfers: {
            activity: accountsAndTransfers.transfers.activity.map((activity) => new Activity(activity.serialize())),
            bills: accountsAndTransfers.transfers.bills.map((bill) => new Bill(bill.serialize())),
        },
    };
    endTiming('cloneAccountsAndTransfers');
    return clone;
}
function runSimulations(accountsAndTransfers, nSimulations, startDate, endDate, simulation) {
    const minDate = getMinDate(accountsAndTransfers);
    // results[year][account] = [min for each simulation]
    const results = {};
    startTiming('runSimulations');
    for (let i = 0; i < nSimulations; i++) {
        const accountsAndTransfersClone = cloneAccountsAndTransfers(accountsAndTransfers);
        calculateAllActivity(accountsAndTransfersClone, startDate, endDate, simulation, true, i, nSimulations);
        const yearlyGraph = loadYearlyGraph(accountsAndTransfersClone, startDate, endDate, minDate);
        yearlyGraph.labels.forEach((year, idx) => {
            for (const dataset of yearlyGraph.datasets) {
                const account = dataset.label;
                const minBalance = dataset.data[idx];
                if (!results[year]) {
                    results[year] = {};
                }
                if (!results[year][account]) {
                    results[year][account] = {
                        type: accountsAndTransfers.accounts.find((a) => a.name === account)?.type || '',
                        results: [],
                    };
                }
                results[year][account].results.push(minBalance);
            }
        });
    }
    endTiming('runSimulations');
    return results;
}
function calculatePercentiles(results) {
    startTiming('calculatePercentiles');
    const percentiles = Object.keys(results).reduce((acc, year) => {
        acc[year] = Object.keys(results[year]).reduce((acc, account) => {
            const values = results[year][account].results;
            values.sort((a, b) => a - b);
            const median = Math.round(values[Math.floor(values.length / 2)] * 100) / 100;
            const lowerQuartile = Math.round(values[Math.floor(values.length / 4)] * 100) / 100;
            const upperQuartile = Math.round(values[Math.floor((values.length * 3) / 4)] * 100) / 100;
            const min = Math.round(values[0] * 100) / 100;
            const max = Math.round(values[values.length - 1] * 100) / 100;
            const percentiles = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].map((percentile) => {
                return Math.round(values[Math.floor(values.length * percentile)] * 100) / 100;
            });
            acc[account] = { median, lowerQuartile, upperQuartile, min, max, percentiles };
            return acc;
        }, {});
        return acc;
    }, {});
    endTiming('calculatePercentiles');
    return percentiles;
}
function createDatasets(percentileData, accountsAndTransfers, selectedAccounts) {
    startTiming('createDatasets');
    const colors = [
        '#FF0000',
        '#00FF00',
        '#0000FF',
        '#FFFF00',
        '#00FFFF',
        '#FF00FF',
        '#C0C0C0',
        '#808080',
        '#800000',
        '#808000',
        '#008000',
    ];
    const datasets = [];
    let colorsIdx = 0;
    accountsAndTransfers.accounts.forEach((account) => {
        if ((selectedAccounts.length > 0 && !selectedAccounts.includes(account.id)) ||
            (selectedAccounts.length === 0 && account.hidden)) {
            return;
        }
        const color = colors[colorsIdx % colors.length];
        datasets.push({
            label: account.name + ' Max',
            data: Object.keys(percentileData).map((year) => percentileData[year][account.name].max),
            borderColor: color,
            backgroundColor: color,
        });
        datasets.push({
            label: account.name + ' Upper Quartile',
            data: Object.keys(percentileData).map((year) => percentileData[year][account.name].upperQuartile),
            borderColor: color,
            backgroundColor: color,
        });
        datasets.push({
            label: account.name + ' Median',
            data: Object.keys(percentileData).map((year) => percentileData[year][account.name].median),
            borderColor: color,
            backgroundColor: color,
        });
        datasets.push({
            label: account.name + ' Lower Quartile',
            data: Object.keys(percentileData).map((year) => percentileData[year][account.name].lowerQuartile),
            borderColor: color,
            backgroundColor: color,
        });
        datasets.push({
            label: account.name + ' Min',
            data: Object.keys(percentileData).map((year) => percentileData[year][account.name].min),
            borderColor: color,
            backgroundColor: color,
        });
        colorsIdx += 1;
    });
    endTiming('createDatasets');
    return datasets;
}
function createGraph(accountsAndTransfers, results, percentileData, selectedAccounts) {
    startTiming('createGraph');
    const datasets = createDatasets(percentileData, accountsAndTransfers, selectedAccounts);
    const graph = {
        labels: Object.keys(results),
        datasets,
    };
    endTiming('createGraph');
    return graph;
}
function formBarChartDataset(results, thresholdTop, thresholdBottom, color, nSimulations) {
    startTiming('formBarChartDataset');
    const dataset = {
        label: thresholdBottom ? `Between $ ${thresholdTop} and $ ${thresholdBottom}` : `Below $ ${thresholdTop}`,
        data: Object.keys(results)
            .filter((year) => parseDate(year).getFullYear() > new Date().getFullYear())
            .map((year) => {
            const yearData = results[year];
            const checkingSums = Array(yearData[Object.keys(yearData)[0]].results.length).fill(0);
            Object.keys(yearData).forEach((account) => {
                if (yearData[account].type === 'Checking') {
                    yearData[account].results.forEach((balance, simIndex) => {
                        checkingSums[simIndex] += balance;
                    });
                }
            });
            // const meetsThreshold = Object.keys(yearData).filter(
            //   (account) =>
            //     yearData[account].type === 'Checking' &&
            //     yearData[account].results.some((balance) =>
            //       thresholdBottom ? balance <= thresholdTop && balance > thresholdBottom : balance < thresholdTop,
            //     ),
            // );
            const meetsThreshold = checkingSums.filter((balance) => thresholdBottom ? balance <= thresholdTop && balance > thresholdBottom : balance < thresholdTop);
            return meetsThreshold.length / nSimulations;
            // return checkingSums;
        }),
        backgroundColor: color,
    };
    endTiming('formBarChartDataset');
    return dataset;
}
function formBarChartDatasets(results, nSimulations) {
    startTiming('formBarChartDatasets');
    const colors = [
        '#FF0000',
        '#00FF00',
        '#0000FF',
        '#FFFF00',
        '#00FFFF',
        '#FF00FF',
        '#C0C0C0',
        '#808080',
        '#800000',
        '#808000',
        '#008000',
    ];
    Object.keys(results).forEach((year) => {
        const yearData = results[year];
        const checkingSums = Array(yearData[Object.keys(yearData)[0]].results.length).fill(0);
        Object.keys(yearData).forEach((account) => {
            if (yearData[account].type === 'Checking') {
                yearData[account].results.forEach((balance, simIndex) => {
                    checkingSums[simIndex] += balance;
                });
            }
        });
    });
    const thresholds = [0];
    const datasets = [];
    thresholds.forEach((threshold, tIdx) => {
        let dataset;
        if (tIdx < thresholds.length - 1) {
            dataset = formBarChartDataset(results, threshold, thresholds[tIdx + 1], colors[tIdx % colors.length], nSimulations);
        }
        else {
            dataset = formBarChartDataset(results, threshold, null, colors[tIdx % colors.length], nSimulations);
        }
        datasets.push(dataset);
    });
    endTiming('formBarChartDatasets');
    return datasets;
}
function createBarChart(results, nSimulations) {
    startTiming('createBarChart');
    const years = Object.keys(results)
        .map((d) => parseDate(d).getFullYear())
        .filter((year) => year > new Date().getFullYear());
    const barChart = {
        labels: years,
        datasets: formBarChartDatasets(results, nSimulations),
    };
    endTiming('createBarChart');
    return barChart;
}
export function monteCarlo(accountsAndTransfers, nSimulations, 
// startDate: Date,
// endDate: Date,
simulation, useExistingSimulations = true, selectedAccounts = [], chartType = 'line') {
    startTiming('monteCarlo');
    const startDate = new Date('2025-01-01');
    const endDate = new Date('2083-12-31');
    // For each simulation, we need to:
    // 1. Create a new accountsAndTransfers object
    // 2. Perform the calculations for the simulation
    // 3. Store the minimum balance for each simulation, for each year, for each account
    // 4. Create percentiles for each year, for each account
    // 5. Store the results
    let results = {};
    if (useExistingSimulations) {
        const files = fs.readdirSync(`${BASE_DATA_DIR}/simulations`);
        for (const file of files) {
            if (file.endsWith('.json')) {
                const { results: simulationResults } = load(`simulations/${file}`);
                for (const year of Object.keys(simulationResults)) {
                    for (const account of Object.keys(simulationResults[year])) {
                        if (!results[year]) {
                            results[year] = {};
                        }
                        if (!results[year][account]) {
                            results[year][account] = {
                                type: simulationResults[year][account].type,
                                results: [],
                            };
                        }
                        results[year][account].results.push(...simulationResults[year][account].results);
                    }
                }
            }
        }
    }
    else {
        const id = uuidv4();
        results = runSimulations(accountsAndTransfers, nSimulations, startDate, endDate, simulation);
        save({ results, date: new Date().toISOString() }, `simulations/${id}.json`);
    }
    // const percentileData = calculatePercentiles(results);
    // const graph = createGraph(accountsAndTransfers, results, percentileData, selectedAccounts);
    // endTiming('monteCarlo');
    // return { graph, id };
    if (chartType === 'line') {
        const percentileData = calculatePercentiles(results);
        const graph = createGraph(accountsAndTransfers, results, percentileData, selectedAccounts);
        return graph;
    }
    else {
        const barChart = createBarChart(results, nSimulations);
        return barChart;
    }
}
