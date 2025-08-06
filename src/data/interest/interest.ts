import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { formatDate } from '../../utils/date/date';
import { loadDateOrVariable } from '../../utils/simulation/loadVariableValue';
import { loadNumberOrVariable } from '../../utils/simulation/loadVariableValue';
import { InterestData } from './types';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '../account/account';
import { Activity } from '../activity/activity';
import { ActivityData } from '../activity/types';

dayjs.extend(utc);

/**
 * Represents an interest rate configuration for an account
 * Supports variable rates and different compounding frequencies
 */
export class Interest {
  id: string;
  apr: number;
  aprIsVariable: boolean;
  aprVariable: string | null;
  monteCarloSampleType: string | null;
  compounded: 'day' | 'week' | 'month' | 'year';
  applicableDate: Date;
  applicableDateIsVariable: boolean;
  applicableDateVariable: string | null;

  /**
   * Creates a new Interest instance
   * @param data - Interest data object
   * @param simulation - Simulation name for variable resolution (defaults to 'Default')
   */
  constructor(data: InterestData, simulation: string = 'Default') {
    this.id = data.id || uuidv4();
    const {
      amount: apr,
      amountIsVariable: aprIsVariable,
      amountVariable: aprVariable,
    } = loadNumberOrVariable(data.apr, data.aprIsVariable, data.aprVariable, simulation);
    this.apr = apr as number;
    this.aprIsVariable = aprIsVariable;
    this.aprVariable = aprVariable;
    this.monteCarloSampleType = data.monteCarloSampleType || null;
    this.compounded = data.compounded;
    const {
      date: applicableDate,
      dateIsVariable: applicableDateIsVariable,
      dateVariable: applicableDateVariable,
    } = loadDateOrVariable(data.applicableDate, data.applicableDateIsVariable, data.applicableDateVariable, simulation);
    this.applicableDate = applicableDate;
    this.applicableDateIsVariable = applicableDateIsVariable;
    this.applicableDateVariable = applicableDateVariable;
  }

  /**
   * Serializes the interest to a plain object for storage
   * @returns Serialized interest data
   */
  serialize(): InterestData {
    return {
      id: this.id,
      apr: this.apr,
      aprIsVariable: this.aprIsVariable,
      aprVariable: this.aprVariable,
      monteCarloSampleType: this.monteCarloSampleType,
      compounded: this.compounded,
      applicableDate: formatDate(this.applicableDate),
      applicableDateIsVariable: this.applicableDateIsVariable,
      applicableDateVariable: this.applicableDateVariable,
    };
  }

  /**
   * Converts the interest to an Activity instance for a specific amount and date
   * @param id - Unique identifier for the activity
   * @param simulation - Simulation name
   * @param amount - Interest amount calculated
   * @param date - Date for the interest activity
   * @returns New Activity instance representing interest earned
   */
  toActivity(id: string, simulation: string, amount: number, date: Date): Activity {
    return new Activity(
      {
        id,
        date: formatDate(date),
        dateIsVariable: false,
        dateVariable: null,
        name: 'Interest',
        category: 'Banking.Interest',
        amount,
        amountIsVariable: false,
        amountVariable: null,
        flag: false,
        isTransfer: false,
        from: null,
        to: null,
        flagColor: null,
      },
      simulation,
    );
  }

  /**
   * Advances the applicable date by the compounding period
   */
  advance() {
    if (this.compounded === 'day') {
      this.applicableDate = dayjs.utc(this.applicableDate).add(1, 'day').toDate();
    } else if (this.compounded === 'week') {
      this.applicableDate = dayjs.utc(this.applicableDate).add(1, 'week').toDate();
    } else if (this.compounded === 'month') {
      this.applicableDate = dayjs.utc(this.applicableDate).add(1, 'month').toDate();
    } else if (this.compounded === 'year') {
      this.applicableDate = dayjs.utc(this.applicableDate).add(1, 'year').toDate();
    }
  }
}

/**
 * Inserts an interest activity into an account and manages interest rate transitions
 * @param account - The account to add interest to
 * @param interest - The interest configuration
 * @param data - Activity data for the interest payment
 * @param simulation - Simulation name (defaults to 'Default')
 */
export function insertInterest(
  account: Account,
  interest: Interest,
  data: ActivityData,
  simulation: string = 'Default',
) {
  account.activity.push(new Activity(data, simulation));
  interest.advance();
  for (const i of account.interests) {
    if (interest.id === i.id) {
      continue;
    }
    if (i.applicableDate <= interest.applicableDate) {
      account.interests.splice(account.interests.indexOf(i), 1);
    }
  }
}

/**
 * Calculates compound interest for a given balance and rate
 * @param balance - Account balance to calculate interest on
 * @param apr - Annual percentage rate
 * @param compounded - Compounding frequency
 * @returns Interest amount for the compounding period
 * @throws Error if compounding frequency is invalid
 */
export function compoundInterest(balance: number, apr: number, compounded: 'day' | 'week' | 'month' | 'year') {
  if (compounded === 'day') {
    return (apr / 365) * balance;
  } else if (compounded === 'week') {
    return (apr / 52) * balance;
  } else if (compounded === 'month') {
    return (apr / 12) * balance;
  } else if (compounded === 'year') {
    return apr * balance;
  } else {
    throw new Error(`Invalid compounded interest: ${compounded}`);
  }
}
