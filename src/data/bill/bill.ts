import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadDateOrVariable, loadNumberOrVariable } from '../../utils/simulation/loadVariableValue';
import { BillData } from './types';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '../account/account';
import { AccountsAndTransfers } from '../account/types';
import { ActivityData } from '../activity/types';
import { Activity } from '../activity/activity';
import { formatDate } from '../../utils/date/date';

dayjs.extend(utc);

/**
 * Represents a recurring bill that can generate activities automatically
 * Supports complex scheduling with annual date ranges, inflation adjustments, and variable amounts
 */
export class Bill {
  id: string;
  name: string;
  category: string;

  isTransfer: boolean;
  fro: string | null;
  to: string | null;

  everyN: number;
  periods: 'day' | 'week' | 'month' | 'year';

  increaseBy: number;
  increaseByIsVariable: boolean;
  increaseByVariable: string | null;
  increaseByDate: { day: number; month: number };
  ceilingMultiple: number;
  monteCarloSampleType: string | null;

  annualStartDate: string | null;
  annualEndDate: string | null;

  isAutomatic: boolean;

  startDate: Date;
  startDateIsVariable: boolean;
  startDateVariable: string | null;

  endDate: Date | null;
  endDateIsVariable: boolean;
  endDateVariable: string | null;

  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  amountIsVariable: boolean;
  amountVariable: string | null;

  flagColor: string | null;
  flag: boolean;

  // Healthcare properties
  isHealthcare: boolean;
  healthcarePerson: string | null;
  copayAmount: number | null;
  coinsurancePercent: number | null;
  countsTowardDeductible: boolean;
  countsTowardOutOfPocket: boolean;

  /**
   * Creates a new Bill instance
   * @param data - Bill data object
   * @param simulation - Simulation name for variable resolution (defaults to 'Default')
   */
  constructor(data: BillData, simulation: string = 'Default') {
    this.initializeBasicProperties(data);
    this.initializeTransferProperties(data);
    this.initializeSchedulingProperties(data);
    this.initializeFlagProperties(data);
    this.initializeInflationProperties(data, simulation);
    this.initializeAnnualDateProperties(data);
    this.initializeDateProperties(data, simulation);
    this.initializeAmountProperties(data, simulation);
    this.initializeHealthcareProperties(data);
  }

  /**
   * Initializes basic bill properties (id, name, category)
   * @private
   */
  private initializeBasicProperties(data: BillData): void {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.category = data.category;
  }

  /**
   * Initializes transfer-related properties
   * @private
   */
  private initializeTransferProperties(data: BillData): void {
    this.isTransfer = data.isTransfer || false;
    this.fro = this.isTransfer ? data.from : null;
    this.to = this.isTransfer ? data.to : null;
  }

  /**
   * Initializes scheduling properties (frequency and period)
   * @private
   */
  private initializeSchedulingProperties(data: BillData): void {
    this.everyN = data.everyN;
    this.periods = data.periods;
    this.isAutomatic = data.isAutomatic || false;
  }

  /**
   * Initializes flag-related properties with default color handling
   * @private
   */
  private initializeFlagProperties(data: BillData): void {
    this.flagColor = data.flagColor || null;
    this.flag = data.flag || false;
    if (this.flag && !this.flagColor) {
      this.flagColor = 'gray';
    }
  }

  /**
   * Initializes inflation and increase properties with error handling
   * @private
   */
  private initializeInflationProperties(data: BillData, simulation: string): void {
    try {
      const {
        amount: increaseBy,
        amountIsVariable: increaseByIsVariable,
        amountVariable: increaseByVariable,
      } = loadNumberOrVariable(data.increaseBy, data.increaseByIsVariable, data.increaseByVariable, simulation);

      this.increaseBy = [true, false].includes(increaseByIsVariable) ? (increaseBy as number) : 0.03;
      this.increaseByIsVariable = [true, false].includes(increaseByIsVariable) ? increaseByIsVariable : true;
      this.increaseByVariable = increaseByVariable || 'INFLATION';
    } catch (e) {
      console.log('Error loading increaseBy for bill', this.name);
      throw e;
    }

    this.increaseByDate = this.setIncreaseByDate(data.increaseByDate);
    this.ceilingMultiple = data.ceilingMultiple || 0;
    this.monteCarloSampleType = data.monteCarloSampleType || null;
  }

  /**
   * Initializes annual date range properties
   * @private
   */
  private initializeAnnualDateProperties(data: BillData): void {
    this.annualStartDate = data.annualStartDate || null;
    this.annualEndDate = data.annualEndDate || null;
  }

  /**
   * Initializes start and end date properties with variable support
   * @private
   */
  private initializeDateProperties(data: BillData, simulation: string): void {
    const {
      date: startDate,
      dateIsVariable: startDateIsVariable,
      dateVariable: startDateVariable,
    } = loadDateOrVariable(data.startDate, data.startDateIsVariable, data.startDateVariable, simulation);

    this.startDate = startDate;
    this.startDateIsVariable = startDateIsVariable;
    this.startDateVariable = startDateVariable;

    if (data.endDate) {
      const {
        date: endDate,
        dateIsVariable: endDateIsVariable,
        dateVariable: endDateVariable,
      } = loadDateOrVariable(data.endDate, data.endDateIsVariable, data.endDateVariable, simulation);

      this.endDate = endDate;
      this.endDateIsVariable = endDateIsVariable;
      this.endDateVariable = endDateVariable;
    } else {
      this.endDate = null;
      this.endDateIsVariable = false;
      this.endDateVariable = null;
    }
  }

  /**
   * Initializes amount properties with variable support
   * @private
   */
  private initializeAmountProperties(data: BillData, simulation: string): void {
    const { amount, amountIsVariable, amountVariable } = loadNumberOrVariable(
      data.amount,
      data.amountIsVariable,
      data.amountVariable,
      simulation,
    );

    this.amount = amount;
    this.amountIsVariable = amountIsVariable;
    this.amountVariable = amountVariable;
  }

  /**
   * Initializes healthcare-related properties
   * @private
   */
  private initializeHealthcareProperties(data: BillData): void {
    this.isHealthcare = data.isHealthcare || false;
    this.healthcarePerson = data.healthcarePerson || null;
    this.copayAmount = data.copayAmount || null;
    this.coinsurancePercent = data.coinsurancePercent || null;
    this.countsTowardDeductible = data.countsTowardDeductible ?? true;
    this.countsTowardOutOfPocket = data.countsTowardOutOfPocket ?? true;
  }

  /**
   * Parses an increase date string into day and month components
   * @param increaseByDate - Date string in MM/DD format
   * @returns Object with day and month (0-indexed)
   */
  setIncreaseByDate(increaseByDate: string): { day: number; month: number } {
    return increaseByDate
      ? {
          day: parseInt(increaseByDate.split('/')[1]),
          month: parseInt(increaseByDate.split('/')[0]) - 1,
        }
      : { day: 1, month: 0 };
  }

  /**
   * Serializes the bill to a plain object for storage
   * @returns Serialized bill data
   */
  serialize(): BillData {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      isTransfer: this.isTransfer,
      from: this.fro,
      to: this.to,
      everyN: this.everyN,
      periods: this.periods,
      increaseBy: this.increaseBy,
      increaseByIsVariable: this.increaseByIsVariable,
      increaseByVariable: this.increaseByVariable,
      increaseByDate: `${(this.increaseByDate.month + 1).toString().padStart(2, '0')}/${this.increaseByDate.day.toString().padStart(2, '0')}`,
      annualStartDate: this.annualStartDate,
      annualEndDate: this.annualEndDate,
      ceilingMultiple: this.ceilingMultiple,
      monteCarloSampleType: this.monteCarloSampleType,
      isAutomatic: this.isAutomatic,
      startDate: formatDate(this.startDate),
      startDateIsVariable: this.startDateIsVariable,
      startDateVariable: this.startDateVariable,
      endDate: this.endDate ? formatDate(this.endDate) : null,
      endDateIsVariable: this.endDateIsVariable,
      endDateVariable: this.endDateVariable,
      amount: this.amount,
      amountIsVariable: this.amountIsVariable,
      amountVariable: this.amountVariable,
      flagColor: this.flagColor,
      flag: this.flag,

      // Healthcare fields
      isHealthcare: this.isHealthcare,
      healthcarePerson: this.healthcarePerson,
      copayAmount: this.copayAmount,
      coinsurancePercent: this.coinsurancePercent,
      countsTowardDeductible: this.countsTowardDeductible,
      countsTowardOutOfPocket: this.countsTowardOutOfPocket,
    };
  }

  /**
   * Converts the bill to an Activity instance for a specific date and amount
   * @param id - Unique identifier for the activity
   * @param simulation - Simulation name
   * @param amount - Amount for the activity
   * @param date - Date for the activity
   * @returns New Activity instance
   */
  toActivity(
    id: string,
    simulation: string,
    amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}',
    date: Date,
  ): Activity {
    return new Activity(
      {
        id: id,
        name: this.name,
        category: this.category,
        amount: amount,
        amountIsVariable: false,
        amountVariable: this.amountVariable,
        date: formatDate(date),
        dateIsVariable: false,
        dateVariable: null,
        flag: this.flag,
        flagColor: this.flagColor,
        from: this.fro,
        to: this.to,
        isTransfer: this.isTransfer,
        // Healthcare fields
        isHealthcare: this.isHealthcare,
        healthcarePerson: this.healthcarePerson,
        copayAmount: this.copayAmount,
        coinsurancePercent: this.coinsurancePercent,
        countsTowardDeductible: this.countsTowardDeductible,
        countsTowardOutOfPocket: this.countsTowardOutOfPocket,
      },
      simulation,
    );
  }

  /**
   * Parses an annual date string to extract month and day
   * @param annualDate - Date string in MM/DD format
   * @returns Array with [month, day]
   */
  getUTCMonthAndDay(annualDate: string) {
    return [parseInt(annualDate.split('/')[0]), parseInt(annualDate.split('/')[1])];
  }

  /**
   * Checks if a date falls within the bill's annual date range and adjusts if necessary
   * Handles complex scenarios including ranges that span multiple years
   * @param date - Date to check
   * @returns Adjusted date that falls within the annual range
   */
  checkAnnualDates(date: Date) {
    const dateMonth = date.getUTCMonth() + 1;
    const dateDay = date.getUTCDate() + 1;
    if (this.annualStartDate && this.annualEndDate) {
      const [annualStartMonth, annualStartDay] = this.getUTCMonthAndDay(this.annualStartDate);
      const [annualEndMonth, annualEndDay] = this.getUTCMonthAndDay(this.annualEndDate);

      if (this.annualStartDate < this.annualEndDate) {
        // Handle normal annual dates (start date is before end date, meaning the range is within a single year)
        if (
          // If we are after the start date
          (dateMonth > annualStartMonth || (dateMonth === annualStartMonth && dateDay >= annualStartDay)) &&
          // And we are before the end date
          (dateMonth < annualEndMonth || (dateMonth === annualEndMonth && dateDay <= annualEndDay))
        ) {
          // We are within the range
          return date;
        }
        // Otherwise, if we are before the start date, advance to the start date of the current year
        if (dateMonth < annualStartMonth || (dateMonth === annualStartMonth && dateDay <= annualStartDay)) {
          return new Date(date.getFullYear(), annualStartMonth, annualStartDay);
        }
        // Otherwise, if we are after the end date, advance to the start date of the next year
        if (dateMonth > annualEndMonth || (dateMonth === annualEndMonth && dateDay >= annualEndDay)) {
          return new Date(date.getFullYear() + 1, annualStartMonth, annualStartDay);
        }
      } else {
        // Handle annual dates that span multiple years (start date is after end date)
        if (
          // If we are after the start date (late in the year)
          dateMonth > annualStartMonth ||
          (dateMonth === annualStartMonth && dateDay >= annualStartDay) ||
          // And we are before the end date (early in the year, i.e. the next year)
          dateMonth < annualEndMonth ||
          (dateMonth === annualEndMonth && dateDay <= annualEndDay)
        ) {
          // We are within the range
          return date;
        }
        // Otherwise, we are before the start date but after the end date, advance to the start date of the current year
        return new Date(date.getFullYear(), annualStartMonth, annualStartDay);
      }
    } else if (this.annualStartDate) {
      const [annualStartMonth, annualStartDay] = this.getUTCMonthAndDay(this.annualStartDate);
      // If we are after the start date
      if (dateMonth > annualStartMonth || (dateMonth === annualStartMonth && dateDay >= annualStartDay)) {
        // We are within the range
        return date;
      }
      // Otherwise, we are before the start date, advance to the start date of the current year
      return new Date(date.getFullYear(), annualStartMonth, annualStartDay);
    } else if (this.annualEndDate) {
      const [annualEndMonth, annualEndDay] = this.getUTCMonthAndDay(this.annualEndDate);
      // If we are before the end date
      if (dateMonth < annualEndMonth || (dateMonth === annualEndMonth && dateDay <= annualEndDay)) {
        // We are within the range
        return date;
      }
      // Otherwise, we are after the end date, advance to the first day of the next year
      return new Date(date.getFullYear() + 1, 1, 1);
    }
    // Handle annual dates lasting the entire year (start date is empty and end date is empty)
    // There is no need to check the dates, as the bill is always within the year
    return date;
  }

  /**
   * Advances the bill's start date by the specified period
   * Automatically adjusts for annual date ranges
   */
  advance() {
    if (this.periods === 'day') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'day').toDate();
    } else if (this.periods === 'week') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'week').toDate();
    } else if (this.periods === 'month') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'month').toDate();
    } else if (this.periods === 'year') {
      this.startDate = dayjs.utc(this.startDate).add(this.everyN, 'year').toDate();
    }
    this.startDate = this.checkAnnualDates(this.startDate);
  }

  /**
   * Skips the next occurrence of this bill by advancing the start date
   * Alias for advance() method
   */
  skip() {
    this.advance();
  }
}

/**
 * Inserts a bill as an activity into the appropriate account or transfer collection
 * @param accountsAndTransfers - The accounts and transfers data structure
 * @param account - The account to add the activity to (if not a transfer)
 * @param bill - The bill being processed
 * @param data - Activity data to insert
 * @param isTransfer - Whether this is a transfer between accounts
 * @param simulation - Simulation name (defaults to 'Default')
 */
export function insertBill(
  accountsAndTransfers: AccountsAndTransfers,
  account: Account,
  bill: Bill,
  data: ActivityData,
  isTransfer: boolean,
  simulation: string = 'Default',
) {
  if (data.amountVariable === '{HALF}' || data.amountVariable === '{FULL}') {
    data.amountIsVariable = false;
    data.amountVariable = null;
  }
  if (isTransfer) {
    accountsAndTransfers.transfers.activity.push(new Activity(data, simulation));
  } else {
    account.activity.push(new Activity(data, simulation));
  }
  bill.advance();
}
