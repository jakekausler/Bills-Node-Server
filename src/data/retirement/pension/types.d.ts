export type PensionData = {
  name: string;
  payToAcccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  startDateVariable: string;
  birthDateVariable: string;
  workStartDateVariable: string;
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
};

export type BenefitRequirement = {
  age?: number;
  yearsWorked: number;
};
