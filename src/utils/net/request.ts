import { Request } from 'express';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { DefaultData, Options, RequestData } from './types';
import { loadData } from '../io/accountsAndTransfers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';

dayjs.extend(utc);

function getSimulation(request: Request, defaultSimulation: string): string {
  return (request.query.simulation as string) || defaultSimulation;
}

function getStartDate(request: Request, defaultStartDate: Date): Date {
  return dayjs.utc((request.query.startDate as string) || defaultStartDate).toDate();
}

function getEndDate(request: Request, defaultEndDate: Date): Date {
  return dayjs.utc((request.query.endDate as string) || defaultEndDate).toDate();
}

function getSelectedAccounts(request: Request, defaultSelectedAccounts: string[]): string[] {
  if (!request.query.selectedAccounts) {
    return defaultSelectedAccounts;
  }
  return (request.query.selectedAccounts as string).split(',');
}

export function getSelectedSimulations(request: Request, defaultSelectedSimulations: string[]): string[] {
  if (!request.query.selectedSimulations) {
    return defaultSelectedSimulations;
  }
  return (request.query.selectedSimulations as string).split(',');
}

function getIsTransfer(request: Request, defaultIsTransfer: boolean): boolean {
  if (!request.query.isTransfer) {
    return defaultIsTransfer;
  }
  return (request.query.isTransfer as string).toLowerCase() === 'true';
}

function getAsActivity(request: Request, defaultAsActivity: boolean): boolean {
  if (!request.query.asActivity) {
    return defaultAsActivity;
  }
  return (request.query.asActivity as string).toLowerCase() === 'true';
}

function getSkip(request: Request, defaultSkip: boolean): boolean {
  if (!request.query.skip) {
    return defaultSkip;
  }
  return (request.query.skip as string).toLowerCase() === 'true';
}

function getPath(request: Request, defaultPath: string[]): string[] {
  if (!request.query.path) {
    return defaultPath;
  }
  return (request.query.path as string).split('.');
}

export function getData<T>(
  request: Request,
  defaults: Partial<DefaultData> = {},
  options: Options = {
    updateCache: false,
  },
): RequestData<T> {
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
  const accountsAndTransfers = loadData(
    options.overrideStartDateForCalculations || startDate,
    endDate,
    simulation,
    options.updateCache,
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
