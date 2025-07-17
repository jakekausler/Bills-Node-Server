import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../../utils/simulation/variable';
import { SocialSecurityData } from './types';

dayjs.extend(utc);

export class SocialSecurity {
  name: string;
  payToAcccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  startDateVariable: string;
  startDate: Date;
  birthDateVariable: string;
  birthDate: Date;
  priorAnnualNetIncomes: number[];
  priorAnnualNetIncomeYears: number[];
  startAge: number;
  average35YearPayInflationAdjusted: number | null;
  monthlyPay: number | null;
  yearTurn60: number;
  collectionAge: number;

  constructor(data: SocialSecurityData, simulation = 'Default') {
    this.name = data.name;
    this.payToAcccount = data.payToAcccount;
    this.paycheckNames = data.paycheckNames;
    this.paycheckAccounts = data.paycheckAccounts;
    this.paycheckCategories = data.paycheckCategories;
    this.startDateVariable = data.startDateVariable;
    this.startDate = loadVariable(data.startDateVariable, simulation) as Date;
    this.birthDateVariable = data.birthDateVariable;
    this.birthDate = loadVariable(data.birthDateVariable, simulation) as Date;
    this.priorAnnualNetIncomes = data.priorAnnualNetIncomes;
    this.priorAnnualNetIncomeYears = data.priorAnnualNetIncomeYears;
    this.startAge = dayjs.utc(this.birthDate).diff(this.startDate, 'year', true);
    this.average35YearPayInflationAdjusted = null;
    this.monthlyPay = null;
    this.yearTurn60 = dayjs.utc(this.birthDate).add(60, 'year').year();
    this.collectionAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', false);
  }

  serialize(): SocialSecurityData {
    return {
      name: this.name,
      payToAcccount: this.payToAcccount,
      paycheckNames: this.paycheckNames,
      paycheckAccounts: this.paycheckAccounts,
      paycheckCategories: this.paycheckCategories,
      startDateVariable: this.startDateVariable,
      birthDateVariable: this.birthDateVariable,
      priorAnnualNetIncomes: this.priorAnnualNetIncomes,
      priorAnnualNetIncomeYears: this.priorAnnualNetIncomeYears,
    };
  }
}
