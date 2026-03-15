import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../../utils/simulation/variable';
import { SocialSecurityData } from './types';

dayjs.extend(utc);

/**
 * Represents a Social Security retirement benefit calculation and payment configuration
 */
export class SocialSecurity {
  /** Name of the social security plan */
  name: string;
  /** Account ID where payments will be deposited */
  payToAccount: string;
  /** Names for paycheck entries */
  paycheckNames: string[];
  /** Account IDs for each paycheck */
  paycheckAccounts: string[];
  /** Categories for each paycheck */
  paycheckCategories: string[];
  /** Variable name for the start date */
  startDateVariable: string;
  /** Calculated start date for benefits */
  startDate: Date;
  /** Variable name for the birth date */
  birthDateVariable: string;
  /** Birth date for age calculations */
  birthDate: Date;
  /** Historical annual net incomes for calculation */
  priorAnnualNetIncomes: number[];
  /** Years corresponding to the income data */
  priorAnnualNetIncomeYears: number[];
  /** Age when benefits start */
  startAge: number;
  /** Calculated average of highest 35 years of income (inflation adjusted) */
  average35YearPayInflationAdjusted: number | null;
  /** Calculated monthly payment amount */
  monthlyPay: number | null;
  /** Year when the person turns 60 (important for SS calculations) */
  yearTurn60: number;
  /** Age at which benefits are collected */
  collectionAge: number;
  /** Year when benefits start (first payment) */
  firstPaymentYear: number | null;
  /** Variable name for COLA adjustment (optional) */
  colaVariable: string | null;

  /**
   * Creates a new Social Security benefit configuration
   * @param data - Social Security configuration data
   * @param simulation - Simulation name for variable resolution (defaults to 'Default')
   */
  constructor(data: SocialSecurityData, simulation = 'Default') {
    this.name = data.name;
    this.payToAccount = data.payToAccount ?? (data as any).payToAcccount;
    this.paycheckNames = [...data.paycheckNames];
    this.paycheckAccounts = [...data.paycheckAccounts];
    this.paycheckCategories = [...data.paycheckCategories];
    this.startDateVariable = data.startDateVariable;
    const startDate = loadVariable(data.startDateVariable, simulation);
    if (!(startDate instanceof Date)) throw new Error(`Invalid date variable: ${data.startDateVariable}`);
    this.startDate = startDate;
    this.birthDateVariable = data.birthDateVariable;
    const birthDate = loadVariable(data.birthDateVariable, simulation);
    if (!(birthDate instanceof Date)) throw new Error(`Invalid date variable: ${data.birthDateVariable}`);
    this.birthDate = birthDate;
    this.priorAnnualNetIncomes = [...data.priorAnnualNetIncomes];
    this.priorAnnualNetIncomeYears = [...data.priorAnnualNetIncomeYears];
    this.startAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', true);
    this.average35YearPayInflationAdjusted = null;
    this.monthlyPay = null;
    this.yearTurn60 = dayjs.utc(this.birthDate).add(60, 'year').year();
    this.collectionAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', false);
    this.firstPaymentYear = null;
    this.colaVariable = data.colaVariable ?? null;
  }

  serialize(): SocialSecurityData {
    const data: SocialSecurityData = {
      name: this.name,
      payToAccount: this.payToAccount,
      paycheckNames: this.paycheckNames,
      paycheckAccounts: this.paycheckAccounts,
      paycheckCategories: this.paycheckCategories,
      startDateVariable: this.startDateVariable,
      birthDateVariable: this.birthDateVariable,
      priorAnnualNetIncomes: this.priorAnnualNetIncomes,
      priorAnnualNetIncomeYears: this.priorAnnualNetIncomeYears,
    };
    if (this.colaVariable) {
      data.colaVariable = this.colaVariable;
    }
    return data;
  }
}
