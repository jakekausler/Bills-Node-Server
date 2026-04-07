export type PensionData = {
  name: string;
  payToAccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  startDateVariable: string;
  person: string;
  workStartDateVariable: string;
  workEndDateVariable?: string;
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
  cola?: {
    type: 'none' | 'fixed' | 'cpiLinked';
    fixedRate?: number;
    cpiCap?: number;
  };
};

export type BenefitRequirement = {
  age?: number;
  yearsWorked: number;
};
