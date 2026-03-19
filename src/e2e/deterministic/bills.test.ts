import { describe, it, expect } from 'vitest';
import {
  getActivitiesByName,
  getActivitiesInMonth,
  getMonthEndBalance,
} from '../helpers';
import {
  calculateInflatedBillAmount,
  getBillOccurrencesInMonth,
} from '../calculators/bill-calculator';

/**
 * Bill scheduling, frequency, inflation, ceiling multiple, and end-date tests.
 *
 * Pattern: engine-anchored — read engine state, compute expected via shadow
 * calculator, assert engine output matches.
 */

// ── Bill configs from data.json ─────────────────────────────────────────────

// Checking account bills
const ALICE_PAYCHECK = {
  account: 'Checking',
  name: 'Alice Paycheck',
  amount: 4200,
  startDate: '2025-01-10',
  endDate: '2028-07-01', // RETIRE_DATE (default)
  everyN: 2,
  periods: 'week',
  increaseBy: 0.03, // RAISE_RATE
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const BOB_PAYCHECK = {
  account: 'Checking',
  name: 'Bob Paycheck',
  amount: 2800,
  startDate: '2025-01-10',
  endDate: '2028-07-01',
  everyN: 2,
  periods: 'week',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const ALICE_PRESCRIPTION = {
  account: 'Checking',
  name: 'Alice Prescription',
  amount: -85,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0, // no inflation
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const DINING_OUT = {
  account: 'Checking',
  name: 'Dining Out',
  amount: -200,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const VACATION = {
  account: 'Checking',
  name: 'Vacation',
  amount: -3000,
  startDate: '2025-06-01',
  endDate: null,
  everyN: 1,
  periods: 'year',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const PROPERTY_TAX = {
  account: 'Checking',
  name: 'Property Tax',
  amount: -3600,
  startDate: '2025-01-15',
  endDate: null,
  everyN: 1,
  periods: 'year',
  increaseBy: 0.03,
  increaseByDate: '01/15',
  ceilingMultiple: 100,
};

const HOME_INSURANCE = {
  account: 'Checking',
  name: 'Home Insurance',
  amount: -1800,
  startDate: '2025-03-01',
  endDate: null,
  everyN: 1,
  periods: 'year',
  increaseBy: -0.02, // DEFLATION_TEST_RATE
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

// Shared Credit Card bills
const GROCERIES = {
  account: 'Shared Credit Card',
  name: 'Groceries',
  amount: -800,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const ELECTRICITY = {
  account: 'Shared Credit Card',
  name: 'Electricity',
  amount: -150,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const INTERNET = {
  account: 'Shared Credit Card',
  name: 'Internet',
  amount: -80,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0.03, // increaseByIsVariable=false but value is 0.03
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

// Alice Credit Card bills
const AUTO_INSURANCE = {
  account: 'Alice Credit Card',
  name: 'Auto Insurance',
  amount: -140,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

const ALICE_DENTAL = {
  account: 'Alice Credit Card',
  name: 'Alice Dental',
  amount: -400,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 6,
  periods: 'month',
  increaseBy: 0, // no inflation
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

// Transfer bills
const MORTGAGE_PAYMENT = {
  fromAccount: 'Checking',
  toAccount: 'Mortgage',
  name: 'Mortgage Payment',
  amount: 2100,
  startDate: '2025-01-01',
  endDate: null,
  everyN: 1,
  periods: 'month',
  increaseBy: 0,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

// 401(k) employer match bills
const ALICE_401K_MATCH = {
  account: 'Alice 401(k)',
  name: 'Alice 401(k) Employer Match',
  amount: 252,
  startDate: '2025-01-10',
  endDate: '2028-07-01',
  everyN: 2,
  periods: 'week',
  increaseBy: 0.03,
  increaseByDate: '01/01',
  ceilingMultiple: 0,
};

// ── Helper: parse increaseByDate into month/day ─────────────────────────────

function parseIncreaseByDate(ibd: string): { month: number; day: number } {
  const [mm, dd] = ibd.split('/');
  return { month: parseInt(mm, 10) - 1, day: parseInt(dd, 10) }; // 0-indexed month
}

// ── Helper: compute shadow amount for a bill at a given date ────────────────

function shadowAmount(
  bill: {
    amount: number;
    increaseBy: number;
    startDate: string;
    increaseByDate: string;
    ceilingMultiple: number;
  },
  currentDate: string,
): number {
  const { month, day } = parseIncreaseByDate(bill.increaseByDate);
  return calculateInflatedBillAmount(
    bill.amount,
    bill.increaseBy,
    bill.startDate,
    currentDate,
    month,
    day,
    bill.ceilingMultiple,
  );
}

// ── Helper: compute shadow occurrences for a bill in a month ────────────────

function shadowOccurrences(
  bill: {
    startDate: string;
    endDate: string | null;
    everyN: number;
    periods: string;
  },
  targetMonth: string,
): string[] {
  return getBillOccurrencesInMonth(
    bill.startDate,
    bill.endDate,
    bill.everyN,
    bill.periods,
    targetMonth,
  );
}

// =============================================================================
// Tests
// =============================================================================

describe('Bills — First month (2025-01)', () => {
  const MONTH = '2025-01';

  it('Alice Paycheck: correct biweekly occurrences in January', () => {
    const expected = shadowOccurrences(ALICE_PAYCHECK, MONTH);
    const actual = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));

    expect(actual.length).toBe(expected.length);
    expect(actual.length).toBeGreaterThanOrEqual(1);

    // All paycheck amounts should be positive
    for (const a of actual) {
      expect(a.amount).toBeGreaterThan(0);
    }

    // First month — no raise yet, should be base amount
    const expectedAmt = shadowAmount(ALICE_PAYCHECK, expected[0]);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });

  it('Bob Paycheck: correct biweekly occurrences in January', () => {
    const expected = shadowOccurrences(BOB_PAYCHECK, MONTH);
    const actual = getActivitiesByName(BOB_PAYCHECK.account, BOB_PAYCHECK.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));

    expect(actual.length).toBe(expected.length);
    expect(actual.length).toBeGreaterThanOrEqual(1);

    const expectedAmt = shadowAmount(BOB_PAYCHECK, expected[0]);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });

  it('Mortgage Payment: $2,100 transfer appears monthly on Checking', () => {
    const actual = getActivitiesByName('Checking', MORTGAGE_PAYMENT.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));

    // Transfer from Checking is negative
    expect(actual.length).toBe(1);
    expect(actual[0].amount).toBeCloseTo(-MORTGAGE_PAYMENT.amount, 2);
  });

  it('Groceries: $800 on Shared Credit Card', () => {
    const actual = getActivitiesByName(GROCERIES.account, GROCERIES.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));

    expect(actual.length).toBe(1);
    // First month, no inflation yet
    const expectedAmt = shadowAmount(GROCERIES, actual[0].date);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });

  it('Alice Prescription: $85 healthcare bill on Checking', () => {
    const actual = getActivitiesByName(ALICE_PRESCRIPTION.account, ALICE_PRESCRIPTION.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));

    expect(actual.length).toBe(1);
    // No inflation, amount stays at base
    expect(actual[0].amount).toBeCloseTo(ALICE_PRESCRIPTION.amount, 2);
  });

  it('Property Tax: appears in Jan on the 15th', () => {
    const expected = shadowOccurrences(PROPERTY_TAX, MONTH);
    expect(expected.length).toBe(1);
    expect(expected[0]).toBe('2025-01-15');

    const actual = getActivitiesByName(PROPERTY_TAX.account, PROPERTY_TAX.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));

    expect(actual.length).toBe(1);
    // First year — base amount with ceiling multiple applied
    const expectedAmt = shadowAmount(PROPERTY_TAX, '2025-01-15');
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });
});

describe('Bills — Steady state + Vacation (2025-06)', () => {
  const MONTH = '2025-06';

  it('Vacation: $3,000 yearly bill appears in June', () => {
    const expected = shadowOccurrences(VACATION, MONTH);
    expect(expected.length).toBe(1);

    const actual = getActivitiesByName(VACATION.account, VACATION.name, 'default')
      .filter((a) => a.date.startsWith('2025-06'));

    expect(actual.length).toBe(1);
    const expectedAmt = shadowAmount(VACATION, actual[0].date);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });

  it('Monthly bills continue in June', () => {
    // Groceries on Shared CC
    const groceries = getActivitiesByName(GROCERIES.account, GROCERIES.name, 'default')
      .filter((a) => a.date.startsWith('2025-06'));
    expect(groceries.length).toBe(1);

    // Dining Out on Checking
    const dining = getActivitiesByName(DINING_OUT.account, DINING_OUT.name, 'default')
      .filter((a) => a.date.startsWith('2025-06'));
    expect(dining.length).toBe(1);

    // Electricity on Shared CC
    const electricity = getActivitiesByName(ELECTRICITY.account, ELECTRICITY.name, 'default')
      .filter((a) => a.date.startsWith('2025-06'));
    expect(electricity.length).toBe(1);

    // Mortgage Payment
    const mortgage = getActivitiesByName('Checking', MORTGAGE_PAYMENT.name, 'default')
      .filter((a) => a.date.startsWith('2025-06'));
    expect(mortgage.length).toBe(1);
  });

  it('Alice Dental: semi-annual (every 6 months) — appears in Jan and Jul, NOT June', () => {
    // Starts 2025-01-01, every 6 months → Jan, Jul
    const juneOccurrences = shadowOccurrences(ALICE_DENTAL, MONTH);
    expect(juneOccurrences.length).toBe(0);

    const actual = getActivitiesByName(ALICE_DENTAL.account, ALICE_DENTAL.name, 'default')
      .filter((a) => a.date.startsWith('2025-06'));
    expect(actual.length).toBe(0);

    // But should appear in July
    const julOccurrences = shadowOccurrences(ALICE_DENTAL, '2025-07');
    expect(julOccurrences.length).toBe(1);
  });
});

describe('Bills — Year-end (2025-12)', () => {
  const MONTH = '2025-12';

  it('All recurring monthly bills appear in December', () => {
    // Groceries
    const groceries = getActivitiesByName(GROCERIES.account, GROCERIES.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(groceries.length).toBe(1);

    // Dining Out
    const dining = getActivitiesByName(DINING_OUT.account, DINING_OUT.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(dining.length).toBe(1);

    // Alice Prescription
    const prescription = getActivitiesByName(ALICE_PRESCRIPTION.account, ALICE_PRESCRIPTION.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(prescription.length).toBe(1);

    // Electricity
    const electricity = getActivitiesByName(ELECTRICITY.account, ELECTRICITY.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(electricity.length).toBe(1);

    // Mortgage
    const mortgage = getActivitiesByName('Checking', MORTGAGE_PAYMENT.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(mortgage.length).toBe(1);
  });

  it('Biweekly paychecks appear in December', () => {
    const alicePaychecks = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(alicePaychecks.length).toBeGreaterThanOrEqual(2);

    const bobPaychecks = getActivitiesByName(BOB_PAYCHECK.account, BOB_PAYCHECK.name, 'default')
      .filter((a) => a.date.startsWith('2025-12'));
    expect(bobPaychecks.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Bills — Inflation check (2026)', () => {
  it('Property Tax Jan 2026: base $3,600 inflated 1 year at 3%, ceiling 100', () => {
    // Property Tax: starts 2025-01-15, yearly, increaseByDate 01/15, ceilingMultiple 100
    // In Jan 2026 the occurrence is on 2026-01-15
    const occurrences = shadowOccurrences(PROPERTY_TAX, '2026-01');
    expect(occurrences.length).toBe(1);
    expect(occurrences[0]).toBe('2026-01-15');

    const expectedAmt = shadowAmount(PROPERTY_TAX, '2026-01-15');

    // Shadow calc: base -3600, ceiling 100 → -3600 (already multiple of 100)
    // 1 year increase milestone (2025-01-15): -3600 * 1.03 = -3708, ceil to -3800
    expect(expectedAmt).toBeCloseTo(-3800, 0);

    const actual = getActivitiesByName(PROPERTY_TAX.account, PROPERTY_TAX.name, 'default')
      .filter((a) => a.date.startsWith('2026-01'));

    expect(actual.length).toBe(1);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });

  it('Home Insurance Mar 2026: base $1,800 deflated 1 year at -2%', () => {
    // Home Insurance: starts 2025-03-01, yearly, increaseByDate 01/01, deflation -0.02
    // Occurrence in Mar 2026 is on 2026-03-01
    const occurrences = shadowOccurrences(HOME_INSURANCE, '2026-03');
    expect(occurrences.length).toBe(1);
    expect(occurrences[0]).toBe('2026-03-01');

    const expectedAmt = shadowAmount(HOME_INSURANCE, '2026-03-01');

    // Shadow calc: base -1800, no ceiling
    // increaseByDate 01/01: milestones at 2025-01-01 and 2026-01-01
    // startDate 2025-03-01, currentDate 2026-03-01
    // 2025-01-01 < 2025-03-01 (start), so NOT counted
    // 2026-01-01 >= 2025-03-01 AND <= 2026-03-01, so counted → 1 milestone
    // -1800 * (1 + (-0.02)) = -1800 * 0.98 = -1764
    expect(expectedAmt).toBeCloseTo(-1764, 2);

    const actual = getActivitiesByName(HOME_INSURANCE.account, HOME_INSURANCE.name, 'default')
      .filter((a) => a.date.startsWith('2026-03'));

    expect(actual.length).toBe(1);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });

  it('Groceries in 2026: inflated by 3% from Jan 2026 onward', () => {
    // Groceries: base -800, increaseByDate 01/01, inflation 0.03
    // In 2026-03, the milestone at 2026-01-01 has passed (start 2025-01-01)
    // Milestones: 2025-01-01 (>= start, counted), 2026-01-01 (counted) → 2 milestones
    // Wait — 2025-01-01 IS the start date, and milestone >= start → counted
    // -800 * 1.03 = -824 (after 2025-01-01), * 1.03 = -848.72 (after 2026-01-01)
    const expectedAmt = shadowAmount(GROCERIES, '2026-03-01');

    const actual = getActivitiesByName(GROCERIES.account, GROCERIES.name, 'default')
      .filter((a) => a.date.startsWith('2026-03'));

    expect(actual.length).toBe(1);
    expect(actual[0].amount).toBeCloseTo(expectedAmt, 2);
  });
});

describe('Bills — Retirement month (2028-07)', () => {
  it('Alice Paycheck: last occurrence on or before 2028-07-01', () => {
    // endDate = 2028-07-01 (RETIRE_DATE for default simulation)
    const allAlice = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default');

    // Verify the last paycheck is on or before the end date
    const lastPaycheck = allAlice[allAlice.length - 1];
    expect(lastPaycheck.date <= '2028-07-01').toBe(true);

    // Verify NO paychecks after retirement
    const postRetirement = allAlice.filter((a) => a.date > '2028-07-01');
    expect(postRetirement.length).toBe(0);
  });

  it('Bob Paycheck: last occurrence on or before 2028-07-01', () => {
    const allBob = getActivitiesByName(BOB_PAYCHECK.account, BOB_PAYCHECK.name, 'default');

    const lastPaycheck = allBob[allBob.length - 1];
    expect(lastPaycheck.date <= '2028-07-01').toBe(true);

    const postRetirement = allBob.filter((a) => a.date > '2028-07-01');
    expect(postRetirement.length).toBe(0);
  });

  it('Alice 401(k) Employer Match: stops at retirement', () => {
    const allMatch = getActivitiesByName(ALICE_401K_MATCH.account, ALICE_401K_MATCH.name, 'default');

    const lastMatch = allMatch[allMatch.length - 1];
    expect(lastMatch.date <= '2028-07-01').toBe(true);

    const postRetirement = allMatch.filter((a) => a.date > '2028-07-01');
    expect(postRetirement.length).toBe(0);
  });

  it('Bills without end dates continue after retirement', () => {
    // Mortgage payment should still appear in August 2028
    const mortgageAug = getActivitiesByName('Checking', MORTGAGE_PAYMENT.name, 'default')
      .filter((a) => a.date.startsWith('2028-08'));
    expect(mortgageAug.length).toBe(1);

    // Groceries should still appear
    const groceriesAug = getActivitiesByName(GROCERIES.account, GROCERIES.name, 'default')
      .filter((a) => a.date.startsWith('2028-08'));
    expect(groceriesAug.length).toBe(1);

    // Dining out should still appear
    const diningAug = getActivitiesByName(DINING_OUT.account, DINING_OUT.name, 'default')
      .filter((a) => a.date.startsWith('2028-08'));
    expect(diningAug.length).toBe(1);
  });
});

describe('Bills — Conservative simulation retirement (2029-07)', () => {
  it('Alice Paycheck: runs until 2029-07-01 in conservative simulation', () => {
    // Conservative RETIRE_DATE = 2029-07-01
    const allAlice = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'conservative');

    // Should have paychecks beyond the default retirement date
    const afterDefaultRetire = allAlice.filter((a) => a.date > '2028-07-01');
    expect(afterDefaultRetire.length).toBeGreaterThan(0);

    // But should stop at or before conservative retirement
    const lastPaycheck = allAlice[allAlice.length - 1];
    expect(lastPaycheck.date <= '2029-07-01').toBe(true);

    // No paychecks after conservative retirement
    const postRetirement = allAlice.filter((a) => a.date > '2029-07-01');
    expect(postRetirement.length).toBe(0);
  });

  it('Bob Paycheck: runs until 2029-07-01 in conservative simulation', () => {
    const allBob = getActivitiesByName(BOB_PAYCHECK.account, BOB_PAYCHECK.name, 'conservative');

    const lastPaycheck = allBob[allBob.length - 1];
    expect(lastPaycheck.date <= '2029-07-01').toBe(true);

    const postRetirement = allBob.filter((a) => a.date > '2029-07-01');
    expect(postRetirement.length).toBe(0);
  });
});

describe('Bills — Biweekly scheduling accuracy', () => {
  it('Alice Paycheck: exactly 14 days between consecutive occurrences', () => {
    const allAlice = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default');
    expect(allAlice.length).toBeGreaterThan(2);

    // Check spacing between first several paychecks
    for (let i = 1; i < Math.min(allAlice.length, 10); i++) {
      const prev = new Date(allAlice[i - 1].date + 'T00:00:00Z');
      const curr = new Date(allAlice[i].date + 'T00:00:00Z');
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBe(14);
    }
  });

  it('Shadow calculator matches engine occurrence count for a full year', () => {
    // Count all Alice Paycheck occurrences in 2025
    let engineCount = 0;
    for (let m = 1; m <= 12; m++) {
      const month = `2025-${String(m).padStart(2, '0')}`;
      const acts = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default')
        .filter((a) => a.date.startsWith(month));
      engineCount += acts.length;
    }

    let shadowCount = 0;
    for (let m = 1; m <= 12; m++) {
      const month = `2025-${String(m).padStart(2, '0')}`;
      const occ = shadowOccurrences(ALICE_PAYCHECK, month);
      shadowCount += occ.length;
    }

    expect(engineCount).toBe(shadowCount);
    // Biweekly from Jan 10 through Dec 31 → should be ~25-26 occurrences
    expect(engineCount).toBeGreaterThanOrEqual(24);
    expect(engineCount).toBeLessThanOrEqual(27);
  });
});

describe('Bills — Ceiling multiple behavior', () => {
  it('Property Tax: ceiling multiple rounds up after each inflation step', () => {
    // 2027-01-15: 2 year milestones from start (2025-01-15, 2026-01-15, 2027-01-15)
    const amt2027 = shadowAmount(PROPERTY_TAX, '2027-01-15');
    // Step 0: -3600, ceil(3600/100)*100 = 3600 → -3600
    // Step 1 (2025-01-15): -3600 * 1.03 = -3708, ceil(3708/100)*100 = 3800 → -3800
    // Step 2 (2026-01-15): -3800 * 1.03 = -3914, ceil(3914/100)*100 = 4000 → -4000
    // Step 3 (2027-01-15): -4000 * 1.03 = -4120, ceil(4120/100)*100 = 4200 → -4200
    // Actually depends on how many milestones: from 2025-01-15 to 2027-01-15
    // countYearIncreases(2025-01-15, 2027-01-15, 0, 15):
    //   year 2025: milestone 2025-01-15 >= start 2025-01-15 AND <= 2027-01-15 → yes
    //   year 2026: milestone 2026-01-15 >= start AND <= 2027-01-15 → yes
    //   year 2027: milestone 2027-01-15 >= start AND <= 2027-01-15 → yes
    //   = 3 milestones
    // -3600 → ceil → -3600; *1.03=-3708 → ceil=-3800; *1.03=-3914 → ceil=-4000; *1.03=-4120 → ceil=-4200

    const actual = getActivitiesByName(PROPERTY_TAX.account, PROPERTY_TAX.name, 'default')
      .filter((a) => a.date.startsWith('2027-01'));

    expect(actual.length).toBe(1);
    expect(actual[0].amount).toBeCloseTo(amt2027, 2);
  });
});

describe('Bills — Raise rate on paychecks', () => {
  it('Alice Paycheck increases by RAISE_RATE (3%) after Jan 1 each year', () => {
    // First paycheck of 2025: base amount 4200
    const jan2025 = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));
    expect(jan2025.length).toBeGreaterThan(0);

    // First paycheck of 2026: should be inflated
    const jan2026 = getActivitiesByName(ALICE_PAYCHECK.account, ALICE_PAYCHECK.name, 'default')
      .filter((a) => a.date.startsWith('2026-01'));
    expect(jan2026.length).toBeGreaterThan(0);

    const expectedBase = shadowAmount(ALICE_PAYCHECK, jan2025[0].date);
    const expectedInflated = shadowAmount(ALICE_PAYCHECK, jan2026[0].date);

    expect(jan2025[0].amount).toBeCloseTo(expectedBase, 2);
    expect(jan2026[0].amount).toBeCloseTo(expectedInflated, 2);

    // The inflated amount should be greater than the base
    expect(Math.abs(jan2026[0].amount)).toBeGreaterThan(Math.abs(jan2025[0].amount));
  });
});

describe('Bills — Semi-annual (every 6 months) scheduling', () => {
  it('Alice Dental: appears every 6 months starting Jan 2025', () => {
    // Should appear in Jan 2025 and Jul 2025
    const jan = getActivitiesByName(ALICE_DENTAL.account, ALICE_DENTAL.name, 'default')
      .filter((a) => a.date.startsWith('2025-01'));
    const jul = getActivitiesByName(ALICE_DENTAL.account, ALICE_DENTAL.name, 'default')
      .filter((a) => a.date.startsWith('2025-07'));
    const jan26 = getActivitiesByName(ALICE_DENTAL.account, ALICE_DENTAL.name, 'default')
      .filter((a) => a.date.startsWith('2026-01'));

    expect(jan.length).toBe(1);
    expect(jul.length).toBe(1);
    expect(jan26.length).toBe(1);

    // No inflation, amount stays constant
    expect(jan[0].amount).toBeCloseTo(ALICE_DENTAL.amount, 2);
    expect(jul[0].amount).toBeCloseTo(ALICE_DENTAL.amount, 2);
    expect(jan26[0].amount).toBeCloseTo(ALICE_DENTAL.amount, 2);
  });
});
