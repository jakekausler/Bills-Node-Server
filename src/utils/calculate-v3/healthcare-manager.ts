import { HealthcareConfig } from '../../data/healthcare/types';

type YearTracker = {
  planYear: number;
  lastResetCheck: Date;
  individualDeductible: Map<string, number>;
  individualOOP: Map<string, number>;
  familyDeductible: number;
  familyOOP: number;
};

export class HealthcareManager {
  private configs: HealthcareConfig[];
  private trackers: Map<string, YearTracker> = new Map();

  constructor(healthcareConfigs: HealthcareConfig[]) {
    this.configs = healthcareConfigs;
  }

  /**
   * Find the active healthcare config for a person at a given date
   */
  getActiveConfig(personName: string, date: Date): HealthcareConfig | null {
    // Filter configs that match the person and date range
    const matchingConfigs = this.configs.filter((config) => {
      if (config.personName !== personName) {
        return false;
      }

      const startDate = new Date(config.startDate);
      if (date < startDate) {
        return false;
      }

      if (config.endDate) {
        const endDate = new Date(config.endDate);
        if (date > endDate) {
          return false;
        }
      }

      return true;
    });

    // If no matches, return null
    if (matchingConfigs.length === 0) {
      return null;
    }

    // If multiple matches, return the most recent (latest start date)
    matchingConfigs.sort((a, b) => {
      const dateA = new Date(a.startDate);
      const dateB = new Date(b.startDate);
      return dateB.getTime() - dateA.getTime();
    });

    return matchingConfigs[0];
  }

  /**
   * Determine which plan year a date falls in based on reset date
   */
  private getPlanYear(config: HealthcareConfig, date: Date): number {
    const currentYear = date.getUTCFullYear();
    const resetMonth = config.resetMonth;
    const resetDay = config.resetDay;

    const dateMonth = date.getUTCMonth();
    const dateDay = date.getUTCDate();

    // Check if current date is before the reset date in the current year
    if (dateMonth < resetMonth || (dateMonth === resetMonth && dateDay < resetDay)) {
      return currentYear - 1;
    }
    return currentYear;
  }
}
