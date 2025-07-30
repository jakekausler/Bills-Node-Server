import { Request } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { DefaultData, PartialDefaultData, Options, RequestData } from './types';
import { loadData } from '../io/accountsAndTransfers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';

dayjs.extend(utc);

/**
 * Extracts simulation name from request query parameters
 * @param request - Express request object
 * @param defaultSimulation - Default simulation to use if none specified
 * @returns Simulation name from query or default
 */
function getSimulation(request: Request, defaultSimulation: string): string {
  return (request.query.simulation as string) || defaultSimulation;
}

/**
 * Extracts and parses start date from request query parameters
 * @param request - Express request object
 * @param defaultStartDate - Default start date to use if none specified
 * @returns Parsed start date from query or default
 */
function getStartDate(request: Request, defaultStartDate: Date): Date {
  return dayjs.utc((request.query.startDate as string) || defaultStartDate).toDate();
}

/**
 * Extracts and parses end date from request query parameters
 * @param request - Express request object
 * @param defaultEndDate - Default end date to use if none specified
 * @returns Parsed end date from query or default
 */
function getEndDate(request: Request, defaultEndDate: Date): Date {
  return dayjs.utc((request.query.endDate as string) || defaultEndDate).toDate();
}

/**
 * Extracts selected accounts from request query parameters
 * @param request - Express request object
 * @param defaultSelectedAccounts - Default accounts to use if none specified
 * @returns Array of selected account IDs from comma-separated query string or default
 */
function getSelectedAccounts(request: Request, defaultSelectedAccounts: string[]): string[] {
  if (!request.query.selectedAccounts) {
    return defaultSelectedAccounts;
  }
  return (request.query.selectedAccounts as string).split(',');
}

/**
 * Extracts selected simulations from request query parameters
 * @param request - Express request object
 * @param defaultSelectedSimulations - Default simulations to use if none specified
 * @returns Array of selected simulation names from comma-separated query string or default
 */
export function getSelectedSimulations(request: Request, defaultSelectedSimulations: string[]): string[] {
  if (!request.query.selectedSimulations) {
    return defaultSelectedSimulations;
  }
  return (request.query.selectedSimulations as string).split(',');
}

/**
 * Extracts transfer flag from request query parameters
 * @param request - Express request object
 * @param defaultIsTransfer - Default transfer flag to use if none specified
 * @returns Boolean indicating if this is a transfer operation
 */
function getIsTransfer(request: Request, defaultIsTransfer: boolean): boolean {
  if (!request.query.isTransfer) {
    return defaultIsTransfer;
  }
  return (request.query.isTransfer as string).toLowerCase() === 'true';
}

/**
 * Extracts activity flag from request query parameters
 * @param request - Express request object
 * @param defaultAsActivity - Default activity flag to use if none specified
 * @returns Boolean indicating if this should be treated as an activity
 */
function getAsActivity(request: Request, defaultAsActivity: boolean): boolean {
  if (!request.query.asActivity) {
    return defaultAsActivity;
  }
  return (request.query.asActivity as string).toLowerCase() === 'true';
}

/**
 * Extracts skip flag from request query parameters
 * @param request - Express request object
 * @param defaultSkip - Default skip flag to use if none specified
 * @returns Boolean indicating if processing should be skipped
 */
function getSkip(request: Request, defaultSkip: boolean): boolean {
  if (!request.query.skip) {
    return defaultSkip;
  }
  return (request.query.skip as string).toLowerCase() === 'true';
}

/**
 * Extracts path array from request query parameters
 * @param request - Express request object
 * @param defaultPath - Default path to use if none specified
 * @returns Array of path segments from dot-separated query string or default
 */
function getPath(request: Request, defaultPath: string[]): string[] {
  if (!request.query.path) {
    return defaultPath;
  }
  return (request.query.path as string).split('.');
}

/**
 * Comprehensive request data parser that extracts and validates all query parameters and request body
 * @param request - Express request object containing query parameters and body
 * @param defaults - Default values for all extractable parameters
 * @param options - Processing options for data loading and caching
 * @returns Complete request data object with parsed parameters, loaded financial data, and metadata
 */
export async function getData<T>(
  request: Request,
  defaults: Partial<DefaultData> = {},
  options: Options = {
    updateCache: false,
  },
): Promise<RequestData<T>> {
  const fullDefaults: DefaultData = {
    defaultSimulation: 'Default',
    defaultStartDate: new Date(),
    defaultEndDate: dayjs.utc().add(6, 'month').toDate(),
    defaultSelectedAccounts: [],
    defaultSelectedSimulations: [],
    defaultIsTransfer: false,
    defaultAsActivity: false,
    defaultSkip: false,
    defaultPath: [],
    ...defaults,
  };
  const simulation = getSimulation(request, fullDefaults.defaultSimulation);
  const startDate = getStartDate(request, fullDefaults.defaultStartDate);
  const endDate = getEndDate(request, fullDefaults.defaultEndDate);
  const selectedAccounts = getSelectedAccounts(request, fullDefaults.defaultSelectedAccounts);
  const selectedSimulations = getSelectedSimulations(request, fullDefaults.defaultSelectedSimulations);
  const isTransfer = getIsTransfer(request, fullDefaults.defaultIsTransfer);
  const skip = getSkip(request, fullDefaults.defaultSkip);
  const accountsAndTransfers = await loadData(
    options.overrideStartDateForCalculations || startDate,
    endDate,
    simulation,
  );
  const { socialSecurities, pensions } = loadPensionsAndSocialSecurity(simulation);
  const asActivity = getAsActivity(request, fullDefaults.defaultAsActivity);
  // Parse the value to JSON if possible
  let data = request.body;
  try {
    data = JSON.parse(data);
  } catch (_) {
    // Pass the raw value if it's not JSON
  }
  const path = getPath(request, fullDefaults.defaultPath);

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
