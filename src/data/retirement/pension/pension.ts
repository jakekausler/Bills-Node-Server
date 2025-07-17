import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { loadVariable } from '../../../utils/simulation/variable';
import { BenefitRequirement, PensionData } from './types';

dayjs.extend(utc);

export class Pension {
  name: string;
  payToAcccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  startDateVariable: string;
  startDate: Date;
  birthDateVariable: string;
  birthDate: Date;
  workStartDateVariable: string;
  workStartDate: Date;
  priorAnnualNetIncomes: number[];
  priorAnnualNetIncomeYears: number[];
  unreducedRequirements: BenefitRequirement[];
  reducedRequirements: BenefitRequirement[];
  highestCompensationConsecutiveYearsToAverage: number;
  accrualFactor: number;
  reducedRateByAgeThenYearsOfService: {
    [age: number]: {
      [yearsWorked: number]: number;
    };
  };
  reductionFactor: number;
  startAge: number;
  yearsWorked: number;
  highestCompensationAverage: number | null;
  monthlyPay: number | null;

  constructor(data: PensionData, simulation = 'Default') {
    this.name = data.name;
    this.payToAcccount = data.payToAcccount;
    this.paycheckNames = data.paycheckNames;
    this.paycheckAccounts = data.paycheckAccounts;
    this.paycheckCategories = data.paycheckCategories;
    this.startDateVariable = data.startDateVariable;
    this.startDate = loadVariable(data.startDateVariable, simulation) as Date;
    this.birthDateVariable = data.birthDateVariable;
    this.birthDate = loadVariable(data.birthDateVariable, simulation) as Date;
    this.workStartDateVariable = data.workStartDateVariable;
    this.workStartDate = loadVariable(data.workStartDateVariable, simulation) as Date;
    this.priorAnnualNetIncomes = data.priorAnnualNetIncomes;
    this.priorAnnualNetIncomeYears = data.priorAnnualNetIncomeYears;
    this.unreducedRequirements = data.unreducedRequirements;
    this.reducedRequirements = data.reducedRequirements;
    this.highestCompensationConsecutiveYearsToAverage = data.highestCompensationConsecutiveYearsToAverage;
    this.accrualFactor = data.accrualFactor;
    this.reducedRateByAgeThenYearsOfService = Object.fromEntries(
      Object.entries(data.reducedRateByAgeThenYearsOfService).map(([age, years]) => [
        Number(age),
        Object.fromEntries(Object.entries(years).map(([yearsWorked, rate]) => [Number(yearsWorked), Number(rate)])),
      ]),
    );
    this.startAge = dayjs.utc(this.startDate).diff(this.birthDate, 'year', true);
    this.yearsWorked = dayjs.utc(this.startDate).diff(this.workStartDate, 'year', true);
    this.highestCompensationAverage = null;
    this.reductionFactor = this.calculateReductionFactor();
    this.monthlyPay = null;
  }

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
    if (ageKeys.length === 0) return 1;

    let ageKey = Math.floor(this.startAge);
    if (ageKey < Math.min(...ageKeys)) {
      ageKey = Math.min(...ageKeys);
    } else if (ageKey > Math.max(...ageKeys)) {
      return 1;
    }

    // Get years worked rates
    const yearsWorkedRates = this.reducedRateByAgeThenYearsOfService[ageKey];
    const yearsKeys = Object.keys(yearsWorkedRates).map(Number);
    if (yearsKeys.length === 0) return 1;

    let yearsKey = Math.floor(this.yearsWorked);
    if (yearsKey < Math.min(...yearsKeys)) {
      yearsKey = Math.min(...yearsKeys);
    } else if (yearsKey > Math.max(...yearsKeys)) {
      return 1;
    }

    return yearsWorkedRates[yearsKey];
  }

  serialize(): PensionData {
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
