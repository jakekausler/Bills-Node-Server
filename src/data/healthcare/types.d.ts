import { DateString } from '../../utils/date/types';

export type HealthcareConfig = {
  id: string;
  name: string;
  coveredPersons: string[];  // e.g., ["Jake", "Jane"]
  startDate: DateString;
  endDate: DateString | null;

  // Individual thresholds
  individualDeductible: number;
  individualOutOfPocketMax: number;

  // Family thresholds
  familyDeductible: number;
  familyOutOfPocketMax: number;

  // HSA configuration
  hsaAccountId: string | null;
  hsaReimbursementEnabled: boolean;

  // Reset date
  resetMonth: number;
  resetDay: number;
};

export type HealthcareConfigsData = {
  configs: HealthcareConfig[];
};
