/**
 * Shadow calculator for bill amounts and scheduling.
 * Independent implementation — no engine imports.
 *
 * Replicates the bill inflation logic from Timeline.calculateBillAmount
 * and the occurrence scheduling from Timeline.generateBillEvents / nextDate.
 */

/**
 * Count how many "increase milestones" fall in the range [startDate, currentDate].
 *
 * The engine iterates year-by-year from startDate's year to currentDate's year,
 * checking whether the milestone (increaseByMonth/increaseByDay) in each year
 * falls within [startDate, currentDate] (inclusive on both ends).
 *
 * @param startDate   - Bill start date (ISO string YYYY-MM-DD)
 * @param currentDate - The occurrence date being evaluated (ISO string YYYY-MM-DD)
 * @param increaseByMonth - 0-indexed month for the annual increase milestone
 * @param increaseByDay   - Day of month for the annual increase milestone
 * @returns Number of increase milestones that have occurred
 */
export function countYearIncreases(
  startDate: string,
  currentDate: string,
  increaseByMonth: number,
  increaseByDay: number,
): number {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(currentDate + 'T00:00:00Z');

  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();

  let count = 0;
  for (let year = startYear; year <= endYear; year++) {
    const milestone = new Date(Date.UTC(year, increaseByMonth, increaseByDay));
    if (milestone >= start && milestone <= end) {
      count++;
    }
  }
  return count;
}

/**
 * Calculate the inflated bill amount for a given occurrence date.
 *
 * Matches the engine's `calculateBillAmount` logic:
 * 1. Start with baseAmount
 * 2. Apply ceilingMultiple to the base amount (round up to nearest multiple)
 * 3. For each year-increase milestone between startDate and currentDate:
 *    a. Multiply by (1 + inflationRate)
 *    b. Re-apply ceilingMultiple after each step
 *
 * @param baseAmount       - The bill's base amount
 * @param inflationRate    - Annual increase rate (e.g. 0.03 for 3%)
 * @param startDate        - Bill start date (ISO YYYY-MM-DD)
 * @param currentDate      - The occurrence date (ISO YYYY-MM-DD)
 * @param increaseByMonth  - 0-indexed month for the annual increase (default 0 = January)
 * @param increaseByDay    - Day of month for the annual increase (default 1)
 * @param ceilingMultiple  - If > 0, round absolute value up to next multiple each step
 * @returns The inflated amount
 */
export function calculateInflatedBillAmount(
  baseAmount: number,
  inflationRate: number,
  startDate: string,
  currentDate: string,
  increaseByMonth: number = 0,
  increaseByDay: number = 1,
  ceilingMultiple: number = 0,
): number {
  let amount = baseAmount;

  // Apply ceilingMultiple to the base amount
  if (ceilingMultiple > 0) {
    amount = Math.ceil(amount / ceilingMultiple) * ceilingMultiple;
  }

  // Apply inflation if configured
  if (inflationRate) {
    const yearsDiff = countYearIncreases(startDate, currentDate, increaseByMonth, increaseByDay);
    for (let i = 0; i < yearsDiff; i++) {
      amount *= 1 + inflationRate;
      // Re-apply ceilingMultiple after each inflation step
      if (ceilingMultiple > 0) {
        amount = Math.ceil(amount / ceilingMultiple) * ceilingMultiple;
      }
    }
  }

  return amount;
}

/**
 * Advance a date by `everyN` units of the given period.
 *
 * Matches the engine's `nextDate` utility:
 * - 'day'   → add everyN days
 * - 'week'  → add everyN * 7 days
 * - 'month' → add everyN months (JS Date UTC month arithmetic)
 * - 'year'  → add everyN years
 *
 * @param dateStr  - ISO date string (YYYY-MM-DD)
 * @param periods  - Period unit
 * @param everyN   - Number of periods to advance
 * @returns New date as ISO string (YYYY-MM-DD)
 */
export function advanceDate(
  dateStr: string,
  periods: string,
  everyN: number,
): string {
  const d = new Date(dateStr + 'T00:00:00Z');

  if (periods.startsWith('day')) {
    d.setUTCDate(d.getUTCDate() + everyN);
  } else if (periods.startsWith('week')) {
    d.setUTCDate(d.getUTCDate() + everyN * 7);
  } else if (periods.startsWith('month')) {
    // Month arithmetic: preserve day-of-month clamping (matches dayjs behavior)
    const targetMonth = d.getUTCMonth() + everyN;
    const originalDay = d.getUTCDate();
    d.setUTCMonth(targetMonth, 1); // set to 1st to avoid overflow
    // Clamp day to the last day of the target month
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(originalDay, lastDay));
  } else if (periods.startsWith('year')) {
    const targetYear = d.getUTCFullYear() + everyN;
    const originalDay = d.getUTCDate();
    d.setUTCFullYear(targetYear);
    // Handle leap year edge case (Feb 29 → Feb 28)
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(originalDay, lastDay));
  } else {
    throw new Error(`Invalid period: ${periods}`);
  }

  return formatDateUTC(d);
}

/**
 * Check annual date constraints and adjust date if outside allowed range.
 *
 * Matches the engine's `Bill.checkAnnualDates` logic:
 * - annualStartDate / annualEndDate in "MM/DD" format
 * - If range is within a single year (start < end): skip to start if before, skip to next year's start if after
 * - If range spans year boundary (start > end): only gap is between end and start
 * - If only start: advance to start if before it
 * - If only end: advance to next year's Jan 1 if after it
 *
 * @param dateStr          - ISO date string (YYYY-MM-DD)
 * @param annualStartDate  - "MM/DD" or null
 * @param annualEndDate    - "MM/DD" or null
 * @returns Adjusted date as ISO string (YYYY-MM-DD)
 */
export function checkAnnualDates(
  dateStr: string,
  annualStartDate: string | null,
  annualEndDate: string | null,
): string {
  if (!annualStartDate && !annualEndDate) {
    return dateStr;
  }

  const d = new Date(dateStr + 'T00:00:00Z');
  const dateMonth = d.getUTCMonth() + 1;
  const dateDay = d.getUTCDate();

  const parseMMDD = (s: string): [number, number] => {
    const parts = s.split('/');
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  };

  if (annualStartDate && annualEndDate) {
    const [startMonth, startDay] = parseMMDD(annualStartDate);
    const [endMonth, endDay] = parseMMDD(annualEndDate);

    const afterOrAtStart = dateMonth > startMonth || (dateMonth === startMonth && dateDay >= startDay);
    const beforeOrAtEnd = dateMonth < endMonth || (dateMonth === endMonth && dateDay <= endDay);

    if (annualStartDate < annualEndDate) {
      // Range within a single year
      if (afterOrAtStart && beforeOrAtEnd) {
        return dateStr; // within range
      }
      if (dateMonth < startMonth || (dateMonth === startMonth && dateDay <= startDay)) {
        return formatDateUTC(new Date(Date.UTC(d.getUTCFullYear(), startMonth - 1, startDay)));
      }
      if (dateMonth > endMonth || (dateMonth === endMonth && dateDay >= endDay)) {
        return formatDateUTC(new Date(Date.UTC(d.getUTCFullYear() + 1, startMonth - 1, startDay)));
      }
    } else {
      // Range spans year boundary (e.g. 10/01 to 03/31)
      if (afterOrAtStart || beforeOrAtEnd) {
        return dateStr; // within range
      }
      // In the gap between end and start — advance to start of current year
      return formatDateUTC(new Date(Date.UTC(d.getUTCFullYear(), startMonth - 1, startDay)));
    }
  } else if (annualStartDate) {
    const [startMonth, startDay] = parseMMDD(annualStartDate);
    if (dateMonth > startMonth || (dateMonth === startMonth && dateDay >= startDay)) {
      return dateStr;
    }
    return formatDateUTC(new Date(Date.UTC(d.getUTCFullYear(), startMonth - 1, startDay)));
  } else if (annualEndDate) {
    const [endMonth, endDay] = parseMMDD(annualEndDate);
    if (dateMonth < endMonth || (dateMonth === endMonth && dateDay <= endDay)) {
      return dateStr;
    }
    return formatDateUTC(new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)));
  }

  return dateStr;
}

/**
 * Get all bill occurrence dates within a specific target month.
 *
 * Walks the bill schedule from startDate, advancing by everyN/periods and
 * applying annual date constraints, collecting occurrences that fall in the
 * target year-month.
 *
 * @param billStartDate    - Bill start date (ISO YYYY-MM-DD)
 * @param billEndDate      - Bill end date (ISO YYYY-MM-DD) or null for no end
 * @param everyN           - Frequency count
 * @param periods          - Period unit ('day' | 'week' | 'month' | 'year')
 * @param targetYearMonth  - Target month as "YYYY-MM"
 * @param annualStartDate  - Annual start constraint "MM/DD" or null
 * @param annualEndDate    - Annual end constraint "MM/DD" or null
 * @returns Array of ISO date strings (YYYY-MM-DD) for occurrences in the target month
 */
export function getBillOccurrencesInMonth(
  billStartDate: string,
  billEndDate: string | null,
  everyN: number,
  periods: string,
  targetYearMonth: string,
  annualStartDate: string | null = null,
  annualEndDate: string | null = null,
): string[] {
  const targetYear = parseInt(targetYearMonth.split('-')[0], 10);
  const targetMonth = parseInt(targetYearMonth.split('-')[1], 10); // 1-indexed

  // Upper bound: first day of next month
  const nextMonthDate = targetMonth === 12
    ? new Date(Date.UTC(targetYear + 1, 0, 1))
    : new Date(Date.UTC(targetYear, targetMonth, 1));

  const endBound = billEndDate ? new Date(billEndDate + 'T00:00:00Z') : null;

  const occurrences: string[] = [];
  let currentDate = billStartDate;
  let count = 0;

  while (true) {
    const current = new Date(currentDate + 'T00:00:00Z');

    // Stop if past the target month
    if (current >= nextMonthDate) break;

    // Stop if past bill end date
    if (endBound && current > endBound) break;

    // Safety valve
    if (count > 10000) break;

    // Check if this occurrence falls in the target month
    if (current.getUTCFullYear() === targetYear && current.getUTCMonth() + 1 === targetMonth) {
      occurrences.push(currentDate);
    }

    // Advance to next occurrence
    const nextRaw = advanceDate(currentDate, periods, everyN);
    currentDate = checkAnnualDates(nextRaw, annualStartDate, annualEndDate);
    count++;
  }

  return occurrences;
}

/**
 * Format a UTC Date as YYYY-MM-DD string.
 */
function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
