import { formatDate } from '../../utils/date/date';
import { loadDateOrVariable, loadNumberOrVariable } from '../../utils/simulation/loadVariableValue';
import { ActivityData } from './types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Represents a financial activity (transaction) that can be applied to an account
 * Supports both regular transactions and transfers between accounts
 * Can use variables for dynamic amounts and dates in simulations
 */
export class Activity {
  id: string;
  name: string;
  category: string;

  flagColor: string | null;
  flag: boolean;

  isTransfer: boolean;
  fro: string | null;
  to: string | null;

  amount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}';
  amountIsVariable: boolean;
  amountVariable: string | null;

  date: Date;
  dateIsVariable: boolean;
  dateVariable: string | null;

  // Healthcare properties
  isHealthcare: boolean;
  healthcarePerson: string | null;
  copayAmount: number | null;
  coinsurancePercent: number | null;
  countsTowardDeductible: boolean;
  countsTowardOutOfPocket: boolean;

  /**
   * Creates a new Activity instance
   * @param data - Activity data object
   * @param simulation - Simulation name for variable resolution (defaults to 'Default')
   */
  constructor(data: ActivityData, simulation: string = 'Default') {
    this.id = data.id || uuidv4();
    this.name = data.name;
    this.category = data.category;

    this.flag = data.flag || false;
    this.flagColor = data.flagColor || null;
    if (this.flag && !this.flagColor) {
      this.flagColor = 'gray';
    }

    this.isTransfer = data.isTransfer || false;
    this.fro = this.isTransfer ? data.from : null;
    this.to = this.isTransfer ? data.to : null;

    const { date, dateIsVariable, dateVariable } = loadDateOrVariable(
      data.date,
      data.dateIsVariable,
      data.dateVariable,
      simulation,
    );
    this.date = date;
    this.dateIsVariable = dateIsVariable;
    this.dateVariable = dateVariable;

    const { amount, amountIsVariable, amountVariable } = loadNumberOrVariable(
      data.amount,
      data.amountIsVariable,
      data.amountVariable,
      simulation,
    );
    this.amount = amount;
    this.amountIsVariable = amountIsVariable;
    this.amountVariable = amountVariable;

    // Healthcare properties
    this.isHealthcare = data.isHealthcare || false;
    this.healthcarePerson = data.healthcarePerson || null;
    this.copayAmount = data.copayAmount || null;
    this.coinsurancePercent = data.coinsurancePercent || null;
    this.countsTowardDeductible = data.countsTowardDeductible ?? true;
    this.countsTowardOutOfPocket = data.countsTowardOutOfPocket ?? true;
  }

  /**
   * Serializes the activity to a plain object for storage
   * @returns Serialized activity data
   */
  serialize(): ActivityData {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      flag: this.flag,
      flagColor: this.flagColor,
      isTransfer: this.isTransfer,
      from: this.fro,
      to: this.to,
      amount: this.amount,
      amountIsVariable: this.amountIsVariable,
      amountVariable: this.amountVariable,
      date: formatDate(this.date),
      dateIsVariable: this.dateIsVariable,
      dateVariable: this.dateVariable,

      // Healthcare fields
      isHealthcare: this.isHealthcare,
      healthcarePerson: this.healthcarePerson,
      copayAmount: this.copayAmount,
      coinsurancePercent: this.coinsurancePercent,
      countsTowardDeductible: this.countsTowardDeductible,
      countsTowardOutOfPocket: this.countsTowardOutOfPocket,
    };
  }
}
