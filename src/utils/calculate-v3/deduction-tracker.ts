import { DebugLogger } from './debug-logger';

type DeductionCategory = 'mortgageInterest' | 'propertyTax' | 'charitable' | 'stateTax' | 'studentLoanInterest' | 'hsaContribution' | 'traditionalIRA';

const SALT_CAP = 10000;
const STUDENT_LOAN_CAP = 2500;

export class DeductionTracker {
  private deductions: Map<number, Map<DeductionCategory, number>> = new Map();
  private checkpointData: string | null = null;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(debugLogger?: DebugLogger | null, simNumber: number = 0) {
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  setCurrentDate(date: string): void {
    this.currentDate = date;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, {
      component: 'deduction-tracker',
      event,
      ...(this.currentDate ? { ts: this.currentDate } : {}),
      ...data,
    });
  }

  addDeduction(year: number, category: DeductionCategory, amount: number): void {
    if (amount <= 0) return;
    if (!this.deductions.has(year)) this.deductions.set(year, new Map());
    const yearMap = this.deductions.get(year)!;
    yearMap.set(category, (yearMap.get(category) ?? 0) + amount);
    this.log('deduction-added', { year, category, amount, total: yearMap.get(category) });
  }

  getItemizedTotal(year: number): number {
    const yearMap = this.deductions.get(year);
    if (!yearMap) return 0;
    const mortgage = yearMap.get('mortgageInterest') ?? 0;
    const property = yearMap.get('propertyTax') ?? 0;
    const charitable = yearMap.get('charitable') ?? 0;
    const stateTax = yearMap.get('stateTax') ?? 0;
    const salt = Math.min(stateTax + property, SALT_CAP); // SALT cap applies to state+local tax combined
    return mortgage + salt + charitable;
  }

  getAboveTheLineTotal(year: number): number {
    const yearMap = this.deductions.get(year);
    if (!yearMap) return 0;
    const hsa = yearMap.get('hsaContribution') ?? 0;
    const studentLoan = Math.min(yearMap.get('studentLoanInterest') ?? 0, STUDENT_LOAN_CAP);
    const ira = yearMap.get('traditionalIRA') ?? 0;
    return hsa + studentLoan + ira;
  }

  getDeductionsByCategory(year: number): Record<string, number> {
    const yearMap = this.deductions.get(year);
    if (!yearMap) return {};
    const result: Record<string, number> = {};
    yearMap.forEach((v, k) => {
      result[k] = v;
    });
    return result;
  }

  checkpoint(): void {
    const obj: Record<string, Record<string, number>> = {};
    this.deductions.forEach((yearMap, year) => {
      obj[year.toString()] = {};
      yearMap.forEach((amount, cat) => {
        obj[year.toString()][cat] = amount;
      });
    });
    this.checkpointData = JSON.stringify(obj);
    this.log('checkpoint-saved');
  }

  restore(): void {
    if (!this.checkpointData) return;
    const data = JSON.parse(this.checkpointData) as Record<string, Record<string, number>>;
    this.deductions = new Map();
    for (const yearStr of Object.keys(data)) {
      const yearMap = new Map<DeductionCategory, number>();
      for (const cat of Object.keys(data[yearStr])) {
        yearMap.set(cat as DeductionCategory, data[yearStr][cat]);
      }
      this.deductions.set(parseInt(yearStr, 10), yearMap);
    }
    this.log('checkpoint-restored');
  }
}
