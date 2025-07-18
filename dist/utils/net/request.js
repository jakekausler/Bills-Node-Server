import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadData } from '../io/accountsAndTransfers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';
dayjs.extend(utc);
/**
 * Extracts simulation name from request query parameters
 * @param request - Express request object
 * @param defaultSimulation - Default simulation to use if none specified
 * @returns Simulation name from query or default
 */
function getSimulation(request, defaultSimulation) {
    return request.query.simulation || defaultSimulation;
}
/**
 * Extracts and parses start date from request query parameters
 * @param request - Express request object
 * @param defaultStartDate - Default start date to use if none specified
 * @returns Parsed start date from query or default
 */
function getStartDate(request, defaultStartDate) {
    return dayjs.utc(request.query.startDate || defaultStartDate).toDate();
}
/**
 * Extracts and parses end date from request query parameters
 * @param request - Express request object
 * @param defaultEndDate - Default end date to use if none specified
 * @returns Parsed end date from query or default
 */
function getEndDate(request, defaultEndDate) {
    return dayjs.utc(request.query.endDate || defaultEndDate).toDate();
}
/**
 * Extracts selected accounts from request query parameters
 * @param request - Express request object
 * @param defaultSelectedAccounts - Default accounts to use if none specified
 * @returns Array of selected account IDs from comma-separated query string or default
 */
function getSelectedAccounts(request, defaultSelectedAccounts) {
    if (!request.query.selectedAccounts) {
        return defaultSelectedAccounts;
    }
    return request.query.selectedAccounts.split(',');
}
/**
 * Extracts selected simulations from request query parameters
 * @param request - Express request object
 * @param defaultSelectedSimulations - Default simulations to use if none specified
 * @returns Array of selected simulation names from comma-separated query string or default
 */
export function getSelectedSimulations(request, defaultSelectedSimulations) {
    if (!request.query.selectedSimulations) {
        return defaultSelectedSimulations;
    }
    return request.query.selectedSimulations.split(',');
}
/**
 * Extracts transfer flag from request query parameters
 * @param request - Express request object
 * @param defaultIsTransfer - Default transfer flag to use if none specified
 * @returns Boolean indicating if this is a transfer operation
 */
function getIsTransfer(request, defaultIsTransfer) {
    if (!request.query.isTransfer) {
        return defaultIsTransfer;
    }
    return request.query.isTransfer.toLowerCase() === 'true';
}
/**
 * Extracts activity flag from request query parameters
 * @param request - Express request object
 * @param defaultAsActivity - Default activity flag to use if none specified
 * @returns Boolean indicating if this should be treated as an activity
 */
function getAsActivity(request, defaultAsActivity) {
    if (!request.query.asActivity) {
        return defaultAsActivity;
    }
    return request.query.asActivity.toLowerCase() === 'true';
}
/**
 * Extracts skip flag from request query parameters
 * @param request - Express request object
 * @param defaultSkip - Default skip flag to use if none specified
 * @returns Boolean indicating if processing should be skipped
 */
function getSkip(request, defaultSkip) {
    if (!request.query.skip) {
        return defaultSkip;
    }
    return request.query.skip.toLowerCase() === 'true';
}
/**
 * Extracts path array from request query parameters
 * @param request - Express request object
 * @param defaultPath - Default path to use if none specified
 * @returns Array of path segments from dot-separated query string or default
 */
function getPath(request, defaultPath) {
    if (!request.query.path) {
        return defaultPath;
    }
    return request.query.path.split('.');
}
/**
 * Comprehensive request data parser that extracts and validates all query parameters and request body
 * @param request - Express request object containing query parameters and body
 * @param defaults - Default values for all extractable parameters
 * @param options - Processing options for data loading and caching
 * @returns Complete request data object with parsed parameters, loaded financial data, and metadata
 */
export function getData(request, partialDefaults = {}, options = {
    updateCache: false,
}) {
    const defaults = {
        defaultSimulation: 'Default',
        defaultStartDate: new Date(),
        defaultEndDate: dayjs.utc().add(6, 'month').toDate(),
        defaultSelectedAccounts: [],
        defaultSelectedSimulations: [],
        defaultIsTransfer: false,
        defaultAsActivity: false,
        defaultSkip: false,
        defaultPath: [],
        ...partialDefaults,
    };
    const simulation = getSimulation(request, defaults.defaultSimulation);
    const startDate = getStartDate(request, defaults.defaultStartDate);
    const endDate = getEndDate(request, defaults.defaultEndDate);
    const selectedAccounts = getSelectedAccounts(request, defaults.defaultSelectedAccounts);
    const selectedSimulations = getSelectedSimulations(request, defaults.defaultSelectedSimulations);
    const isTransfer = getIsTransfer(request, defaults.defaultIsTransfer);
    const skip = getSkip(request, defaults.defaultSkip);
    const accountsAndTransfers = loadData(options.overrideStartDateForCalculations || startDate, endDate, simulation, options.updateCache);
    const { socialSecurities, pensions } = loadPensionsAndSocialSecurity(simulation);
    const asActivity = getAsActivity(request, defaults.defaultAsActivity);
    // Parse the value to JSON if possible
    let data = request.body;
    try {
        data = JSON.parse(data);
    }
    catch (_) {
        // Pass the raw value if it's not JSON
    }
    const path = getPath(request, defaults.defaultPath);
    return {
        simulation,
        startDate,
        endDate,
        selectedAccounts,
        selectedSimulations,
        isTransfer,
        skip,
        accountsAndTransfers,
        asActivity,
        data,
        path,
        socialSecurities,
        pensions,
        options,
    };
}
