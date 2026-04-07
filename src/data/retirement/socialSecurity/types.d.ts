export type SocialSecurityData = {
  name: string;
  payToAccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  person: string;
  priorAnnualNetIncomes: number[];
  priorAnnualNetIncomeYears: number[];
  colaVariable?: string;
  spouseName?: string;
};
