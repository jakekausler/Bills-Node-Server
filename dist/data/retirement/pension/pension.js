import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../../utils/simulation/variable';
dayjs.extend(utc);
/**
 * Represents a pension plan with complex benefit calculations based on age, years of service, and compensation
 */
export class Pension {
    /** Name of the pension plan */
    name;
    /** Account ID where pension payments will be deposited */
    payToAcccount;
    /** Names for paycheck entries */
    paycheckNames;
    /** Account IDs for each paycheck */
    paycheckAccounts;
    /** Categories for each paycheck */
    paycheckCategories;
    /** Variable name for the pension start date */
    startDateVariable;
    /** Calculated pension start date */
    startDate;
    /** Variable name for the birth date */
    birthDateVariable;
    /** Birth date for age calculations */
    birthDate;
    /** Variable name for the work start date */
    workStartDateVariable;
    /** Date when employment began for service calculations */
    workStartDate;
    /** Historical annual net incomes for benefit calculations */
    priorAnnualNetIncomes;
    /** Years corresponding to the income data */
    priorAnnualNetIncomeYears;
    /** Requirements for unreduced (full) pension benefits */
    unreducedRequirements;
    /** Requirements for reduced (early) pension benefits */
    reducedRequirements;
    /** Number of consecutive years to average for highest compensation calculation */
    highestCompensationConsecutiveYearsToAverage;
    /** Factor used to calculate pension benefit based on service and compensation */
    accrualFactor;
    /** Reduction rates based on age and years of service for early retirement */
    reducedRateByAgeThenYearsOfService;
    /** Calculated reduction factor for pension benefits */
    reductionFactor;
    /** Age when pension benefits start */
    startAge;
    /** Total years of service at pension start */
    yearsWorked;
    /** Calculated average of highest compensation years */
    highestCompensationAverage;
    /** Calculated monthly pension payment */
    monthlyPay;
    /**
     * Creates a new pension plan configuration
     * @param data - Pension plan configuration data
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
        this.workStartDateVariable = data.workStartDateVariable;
        this.workStartDate = loadVariable(data.workStartDateVariable, simulation);
        this.priorAnnualNetIncomes = data.priorAnnualNetIncomes;
        this.priorAnnualNetIncomeYears = data.priorAnnualNetIncomeYears;
        this.unreducedRequirements = data.unreducedRequirements;
        this.reducedRequirements = data.reducedRequirements;
        this.highestCompensationConsecutiveYearsToAverage = data.highestCompensationConsecutiveYearsToAverage;
        this.accrualFactor = data.accrualFactor;
        this.reducedRateByAgeThenYearsOfService = Object.fromEntries(Object.entries(data.reducedRateByAgeThenYearsOfService).map(([age, years]) => [
            Number(age),
            Object.fromEntries(Object.entries(years).map(([yearsWorked, rate]) => [Number(yearsWorked), Number(rate)])),
        ]));
        this.startAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', true);
        this.yearsWorked = dayjs.utc(this.startDate).diff(this.workStartDate, 'year', true);
        this.highestCompensationAverage = null;
        this.reductionFactor = this.calculateReductionFactor();
        this.monthlyPay = null;
    }
    /**
     * Calculates the reduction factor for pension benefits based on age and years of service
     * @returns Reduction factor between 0 and 1 (1 = full benefits, 0 = no benefits)
     */
    calculateReductionFactor() {
        // Check unreduced requirements first
        for (const requirement of this.unreducedRequirements) {
            const ageRequirementMet = !requirement.age || this.startAge >= requirement.age;
            const yearsRequirementMet = this.yearsWorked >= requirement.yearsWorked;
            if (ageRequirementMet && yearsRequirementMet) {
                return 1;
            }
        }
        // Check reduced requirements
        let meetsReducedRequirements = false;
        for (const requirement of this.reducedRequirements) {
            const ageRequirementMet = !requirement.age || this.startAge >= requirement.age;
            const yearsRequirementMet = this.yearsWorked >= requirement.yearsWorked;
            if (ageRequirementMet && yearsRequirementMet) {
                meetsReducedRequirements = true;
                break;
            }
        }
        if (!meetsReducedRequirements) {
            return 0;
        }
        // Get age rates
        const ageKeys = Object.keys(this.reducedRateByAgeThenYearsOfService).map(Number);
        if (ageKeys.length === 0)
            return 1;
        let ageKey = Math.floor(this.startAge);
        if (ageKey < Math.min(...ageKeys)) {
            ageKey = Math.min(...ageKeys);
        }
        else if (ageKey > Math.max(...ageKeys)) {
            return 1;
        }
        // Get years worked rates
        const yearsWorkedRates = this.reducedRateByAgeThenYearsOfService[ageKey];
        const yearsKeys = Object.keys(yearsWorkedRates).map(Number);
        if (yearsKeys.length === 0)
            return 1;
        let yearsKey = Math.floor(this.yearsWorked);
        if (yearsKey < Math.min(...yearsKeys)) {
            yearsKey = Math.min(...yearsKeys);
        }
        else if (yearsKey > Math.max(...yearsKeys)) {
            return 1;
        }
        return yearsWorkedRates[yearsKey];
    }
    /**
     * Serializes the pension configuration to a plain object
     * @returns Serialized pension data for storage or transmission
     */
    serialize() {
        return {
            name: this.name,
            payToAcccount: this.payToAcccount,
            paycheckNames: this.paycheckNames,
            paycheckAccounts: this.paycheckAccounts,
            paycheckCategories: this.paycheckCategories,
            startDateVariable: this.startDateVariable,
            birthDateVariable: this.birthDateVariable,
            workStartDateVariable: this.workStartDateVariable,
            priorAnnualNetIncomes: this.priorAnnualNetIncomes,
            priorAnnualNetIncomeYears: this.priorAnnualNetIncomeYears,
            unreducedRequirements: this.unreducedRequirements,
            reducedRequirements: this.reducedRequirements,
            highestCompensationConsecutiveYearsToAverage: this.highestCompensationConsecutiveYearsToAverage,
            accrualFactor: this.accrualFactor,
            reducedRateByAgeThenYearsOfService: this.reducedRateByAgeThenYearsOfService,
        };
    }
}
