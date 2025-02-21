import { Request } from 'express';
import dayjs from 'dayjs';
import { DefaultData, Options, RequestData } from './types';
import { loadData } from '../io/accountsAndTransfers';
import { loadPensionsAndSocialSecurity } from '../io/retirement';

function getSimulation(request: Request, defaultSimulation: string): string {
  return (request.query.simulation as string) || defaultSimulation;
}

function getStartDate(request: Request, defaultStartDate: Date): Date {
  return dayjs((request.query.startDate as string) || defaultStartDate).toDate();
}

function getEndDate(request: Request, defaultEndDate: Date): Date {
  return dayjs((request.query.endDate as string) || defaultEndDate).toDate();
}

function getSelectedAccounts(request: Request, defaultSelectedAccounts: string[]): string[] {
  if (!request.query.selectedAccounts) {
    return defaultSelectedAccounts;
  }
  return (request.query.selectedAccounts as string).split(',');
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

export async function getData<T>(
  request: Request,
  defaults: DefaultData = {
    defaultSimulation: 'Default',
    defaultStartDate: new Date(),
    defaultEndDate: dayjs().add(6, 'month').toDate(),
    defaultSelectedAccounts: [],
    defaultIsTransfer: false,
    defaultAsActivity: false,
    defaultSkip: false,
    defaultPath: [],
  },
  options: Options = {
    updateCache: false,
  },
): Promise<RequestData<T>> {
  const simulation = getSimulation(request, defaults.defaultSimulation);
  const startDate = getStartDate(request, defaults.defaultStartDate);
  const endDate = getEndDate(request, defaults.defaultEndDate);
  const selectedAccounts = getSelectedAccounts(request, defaults.defaultSelectedAccounts);
  const isTransfer = getIsTransfer(request, defaults.defaultIsTransfer);
  const skip = getSkip(request, defaults.defaultSkip);
  const accountsAndTransfers = await loadData(
    options.overrideStartDateForCalculations || startDate,
    endDate,
    simulation,
    options.updateCache,
  );
  const { socialSecurities, pensions } = loadPensionsAndSocialSecurity(simulation);
  const asActivity = getAsActivity(request, defaults.defaultAsActivity);
  let data = request.body;
  if (typeof data === 'string') {
    // do nothing, keep as is
  } else {
    try {
      data = JSON.parse(data);
    } catch (_) {
      // Pass the raw value if it's not JSON
    }
  }
  const path = getPath(request, defaults.defaultPath);

  return {
    simulation,
    startDate,
    endDate,
    selectedAccounts,
    isTransfer,
    skip,
    accountsAndTransfers,
    asActivity,
    data,
    path,
    socialSecurities,
    pensions,
  };
}
