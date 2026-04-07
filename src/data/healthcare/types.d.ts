import { DateString } from '../../utils/date/types';

export type HealthcareConfig = {
  id: string;
  name: string;
  coveredPersons: string[];  // e.g., ["Person1", "Person2"]
  policyholder?: string | null;  // Whose employment provides the plan (for COBRA)
  startDate: DateString;
  startDateIsVariable?: boolean;
  startDateVariable?: string | null;
  endDate: DateString | null;
  endDateIsVariable?: boolean;
  endDateVariable?: string | null;

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

  // Premium configuration
  monthlyPremium?: number;  // Full monthly plan cost (employee + employer)
  monthlyPremiumInflationVariable?: string;  // e.g., "HEALTHCARE_INFLATION"

  // Deductible/OOP inflation configuration
  deductibleInflationVariable?: string;  // e.g., "HEALTHCARE_INFLATION"
  deductibleInflationRate?: number;       // Fallback fixed rate (e.g., 0.05 for 5%)
};

export type HealthcareConfigsData = {
  configs: HealthcareConfig[];
};
