export type SocialSecurityData = {
  name: string;
  payToAccount: string;
  paycheckNames: string[];
  person: string;
  priorAnnualNetIncomes: number[];
  priorAnnualNetIncomeYears: number[];
  colaVariable?: string;
  spouseName?: string;
};
