import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../../utils/simulation/variable';
dayjs.extend(utc);
/**
 * Represents a Social Security retirement benefit calculation and payment configuration
 */
export class SocialSecurity {
    /** Name of the social security plan */
    name;
    /** Account ID where payments will be deposited */
    payToAcccount;
    /** Names for paycheck entries */
    paycheckNames;
    /** Account IDs for each paycheck */
    paycheckAccounts;
    /** Categories for each paycheck */
    paycheckCategories;
    /** Variable name for the start date */
    startDateVariable;
    /** Calculated start date for benefits */
    startDate;
    /** Variable name for the birth date */
    birthDateVariable;
    /** Birth date for age calculations */
    birthDate;
    /** Historical annual net incomes for calculation */
    priorAnnualNetIncomes;
    /** Years corresponding to the income data */
    priorAnnualNetIncomeYears;
    /** Age when benefits start */
    startAge;
    /** Calculated average of highest 35 years of income (inflation adjusted) */
    average35YearPayInflationAdjusted;
    /** Calculated monthly payment amount */
    monthlyPay;
    /** Year when the person turns 60 (important for SS calculations) */
    yearTurn60;
    /** Age at which benefits are collected */
    collectionAge;
    /**
     * Creates a new Social Security benefit configuration
     * @param data - Social Security configuration data
     * @param simulation - Simulation name for variable resolution (defaults to 'Default')
     */
    constructor(data, simulation = 'Default') {
        this.name = data.name;
        this.payToAcccount = data.payToAcccount;
        this.paycheckNames = data.paycheckNames;
        this.paycheckAccounts = data.paycheckAccounts;
        this.paycheckCategories = data.paycheckCategories;
        this.startDateVariable = data.startDateVariable;
        this.startDate = loadVariable(data.startDateVariable, simulation);
        this.birthDateVariable = data.birthDateVariable;
        this.birthDate = loadVariable(data.birthDateVariable, simulation);
        this.priorAnnualNetIncomes = data.priorAnnualNetIncomes;
        this.priorAnnualNetIncomeYears = data.priorAnnualNetIncomeYears;
        this.startAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', true);
        this.average35YearPayInflationAdjusted = null;
        this.monthlyPay = null;
        this.yearTurn60 = dayjs.utc(this.birthDate).add(60, 'year').year();
        this.collectionAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', false);
    }
    serialize() {
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
