import { DebugLogger } from './debug-logger';

const MAX_JOB_LOSS_PROBABILITY = 0.12;
const DEFAULT_SCALE_FACTOR = 1.5;
const MIN_DURATION_WEEKS = 4;
const MAX_DURATION_WEEKS = 104;
const LOG_NORMAL_SCALE = 0.6;

interface PersonEmploymentState {
  isUnemployed: boolean;
  unemploymentStartDate: Date | null;
  unemploymentEndDate: Date | null;
  raisesSkippedYears: Set<number>;
  // Track all unemployment periods for history
  unemploymentHistory: { start: Date; end: Date }[];
}

export class JobLossManager {
  private state: Map<string, PersonEmploymentState> = new Map();
  private cobraMonthsElapsed: Map<string, number> = new Map(); // for COBRA tracking
  private checkpointData: string | null = null;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  setCurrentDate(date: string): void { this.currentDate = date; }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, {
      component: 'job-loss', event,
      ...(this.currentDate ? { ts: this.currentDate } : {}),
      ...data
    });
  }

  private getOrCreateState(personKey: string): PersonEmploymentState {
    if (!this.state.has(personKey)) {
      this.state.set(personKey, {
        isUnemployed: false,
        unemploymentStartDate: null,
        unemploymentEndDate: null,
        raisesSkippedYears: new Set(),
        unemploymentHistory: [],
      });
    }
    return this.state.get(personKey)!;
  }

  /**
   * Evaluate job loss for a person at the start of a year.
   * Called once per year (January) in MC mode only.
   */
  evaluateYearStart(
    year: number,
    personKey: string,
    retirementDate: Date | null,
    drawnUnemploymentRate: number,
    drawnMedianDurationWeeks: number,
    scaleFactor: number = DEFAULT_SCALE_FACTOR,
    prng: () => number,
  ): void {
    const state = this.getOrCreateState(personKey);

    // Step 1: If currently unemployed and end date is in the future, skip
    if (state.isUnemployed && state.unemploymentEndDate) {
      const janFirst = new Date(Date.UTC(year, 0, 1));
      if (state.unemploymentEndDate > janFirst) {
        this.log('skip-still-unemployed', { personKey, year, endDate: state.unemploymentEndDate.toISOString() });
        return;
      }
      // Re-employment happened (end date passed)
      state.isUnemployed = false;
      this.log('re-employed', { personKey, year });
    }

    // Step 2: If retired, skip
    if (retirementDate) {
      const retireYear = retirementDate.getUTCFullYear();
      if (retireYear <= year) {
        this.log('skip-retired', { personKey, year });
        return;
      }
    }

    // Step 3-4: Compute probability
    const probability = Math.min(drawnUnemploymentRate / 100 * scaleFactor, MAX_JOB_LOSS_PROBABILITY);

    // Step 5: Roll PRNG
    const roll = prng();
    if (roll >= probability) {
      this.log('no-job-loss', { personKey, year, probability, roll });
      return;
    }

    // Job loss triggers!

    // Step 6: Sample duration from log-normal
    // Box-Muller transform: consumes 2 PRNG calls
    const u1 = prng();
    const u2 = prng();
    const normalRandom = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const medianWeeks = Math.max(1, drawnMedianDurationWeeks);
    let durationWeeks = Math.exp(Math.log(medianWeeks) + LOG_NORMAL_SCALE * normalRandom);

    // Step 7: Clamp and round
    durationWeeks = Math.max(MIN_DURATION_WEEKS, Math.min(MAX_DURATION_WEEKS, durationWeeks));
    const durationMonths = Math.max(1, Math.round(durationWeeks / 4.33)); // ~4.33 weeks per month

    // Step 8: Random start month (Q1-Q3, months 0-8 in 0-indexed)
    const startMonthRoll = prng();
    const startMonth = Math.floor(startMonthRoll * 9); // 0-8 (Jan-Sep)

    // Create dates
    const startDate = new Date(Date.UTC(year, startMonth, 1));
    let endDate = new Date(Date.UTC(year, startMonth + durationMonths, 1));

    // Step 10: Cap at retirement
    if (retirementDate && endDate > retirementDate) {
      endDate = retirementDate;
    }

    // Set state
    state.isUnemployed = true;
    state.unemploymentStartDate = startDate;
    state.unemploymentEndDate = endDate;
    state.raisesSkippedYears.add(year);
    state.unemploymentHistory.push({ start: startDate, end: endDate });

    // Reset COBRA tracking for this new unemployment period
    this.cobraMonthsElapsed.set(personKey, 0);

    this.log('job-loss-triggered', {
      personKey, year, probability, roll,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      durationMonths,
      durationWeeks: Math.round(durationWeeks),
      drawnMedianDurationWeeks,
    });
  }

  isUnemployed(personKey: string, date: Date): boolean {
    return this.getActiveUnemploymentPeriod(personKey, date) !== null;
  }

  shouldSkipRaise(personKey: string, year: number): boolean {
    const state = this.state.get(personKey);
    if (!state) return false;
    return state.raisesSkippedYears.has(year);
  }

  getRaisesSkippedYears(personKey: string): Set<number> {
    return this.state.get(personKey)?.raisesSkippedYears ?? new Set();
  }

  getActiveUnemploymentPeriod(personKey: string, date: Date): { start: Date; end: Date } | null {
    const state = this.state.get(personKey);
    if (!state) return null;
    for (const period of state.unemploymentHistory) {
      if (date >= period.start && date < period.end) {
        return period;
      }
    }
    return null;
  }

  getAllUnemploymentPeriods(personKey: string): { start: Date; end: Date }[] {
    return this.state.get(personKey)?.unemploymentHistory ?? [];
  }

  // COBRA tracking
  getCobraMonthsElapsed(personKey: string): number {
    return this.cobraMonthsElapsed.get(personKey) ?? 0;
  }

  incrementCobraMonth(personKey: string): void {
    const current = this.cobraMonthsElapsed.get(personKey) ?? 0;
    this.cobraMonthsElapsed.set(personKey, current + 1);
  }

  // Checkpoint/restore
  checkpoint(): void {
    const stateObj: Record<string, any> = {};
    this.state.forEach((ps, key) => {
      stateObj[key] = {
        isUnemployed: ps.isUnemployed,
        unemploymentStartDate: ps.unemploymentStartDate?.toISOString() ?? null,
        unemploymentEndDate: ps.unemploymentEndDate?.toISOString() ?? null,
        raisesSkippedYears: Array.from(ps.raisesSkippedYears),
        unemploymentHistory: ps.unemploymentHistory.map(p => ({
          start: p.start.toISOString(),
          end: p.end.toISOString(),
        })),
      };
    });
    const cobraObj: Record<string, number> = {};
    this.cobraMonthsElapsed.forEach((v, k) => { cobraObj[k] = v; });
    this.checkpointData = JSON.stringify({ state: stateObj, cobra: cobraObj });
    this.log('checkpoint-saved');
  }

  restore(): void {
    if (!this.checkpointData) return;
    const data = JSON.parse(this.checkpointData);

    this.state = new Map();
    for (const key of Object.keys(data.state)) {
      const ps = data.state[key];
      this.state.set(key, {
        isUnemployed: ps.isUnemployed,
        unemploymentStartDate: ps.unemploymentStartDate ? new Date(ps.unemploymentStartDate) : null,
        unemploymentEndDate: ps.unemploymentEndDate ? new Date(ps.unemploymentEndDate) : null,
        raisesSkippedYears: new Set(ps.raisesSkippedYears),
        unemploymentHistory: ps.unemploymentHistory.map((p: any) => ({
          start: new Date(p.start),
          end: new Date(p.end),
        })),
      });
    }

    this.cobraMonthsElapsed = new Map();
    for (const key of Object.keys(data.cobra)) {
      this.cobraMonthsElapsed.set(key, data.cobra[key]);
    }
    this.log('checkpoint-restored');
  }
}
