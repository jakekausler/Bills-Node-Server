import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const DAY_NAME_TO_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

/**
 * Computes period boundaries for a given interval type and date range.
 *
 * Generates all periods that overlap with [startDate, endDate].
 * A period is included if its periodEnd >= startDate AND periodStart <= endDate.
 * periodEnd is always derived from nextPeriodStart - 1 day.
 *
 * @param interval - The interval type: 'weekly', 'monthly', or 'yearly'
 * @param intervalStart - The period anchor:
 *   - weekly: day name (e.g., "Saturday", "Monday")
 *   - monthly: day of month ("1" through "28")
 *   - yearly: "MM/DD" (e.g., "06/15", "01/01")
 * @param startDate - Start of the date range (inclusive)
 * @param endDate - End of the date range (inclusive)
 * @returns Array of period boundaries sorted chronologically
 */
export function computePeriodBoundaries(
  interval: 'weekly' | 'monthly' | 'yearly',
  intervalStart: string,
  startDate: Date,
  endDate: Date,
): { periodStart: Date; periodEnd: Date }[] {
  // Guard against degenerate range
  if (dayjs.utc(endDate).isBefore(dayjs.utc(startDate), 'day')) {
    return [];
  }

  switch (interval) {
    case 'weekly':
      return computeWeeklyBoundaries(intervalStart, startDate, endDate);
    case 'monthly':
      return computeMonthlyBoundaries(intervalStart, startDate, endDate);
    case 'yearly':
      return computeYearlyBoundaries(intervalStart, startDate, endDate);
  }
}

function computeWeeklyBoundaries(
  dayName: string,
  startDate: Date,
  endDate: Date,
): { periodStart: Date; periodEnd: Date }[] {
  const targetDay = DAY_NAME_TO_INDEX[dayName];
  const start = dayjs.utc(startDate);
  const end = dayjs.utc(endDate);

  // Find the first occurrence of targetDay on or before startDate
  let periodStart = start;
  while (periodStart.day() !== targetDay) {
    periodStart = periodStart.subtract(1, 'day');
  }

  const results: { periodStart: Date; periodEnd: Date }[] = [];

  while (true) {
    const nextPeriodStart = periodStart.add(7, 'day');
    const periodEnd = nextPeriodStart.subtract(1, 'day');

    // Include period if it overlaps with [startDate, endDate]
    if (periodEnd.isBefore(start, 'day')) {
      // periodEnd is before startDate, skip and advance
      periodStart = nextPeriodStart;
      continue;
    }

    if (periodStart.isAfter(end, 'day')) {
      // periodStart is past endDate, stop
      break;
    }

    results.push({
      periodStart: periodStart.toDate(),
      periodEnd: periodEnd.toDate(),
    });

    periodStart = nextPeriodStart;
  }

  return results;
}

/**
 * Computes the start of a monthly period for a given year/month,
 * clamping the day to the last day of that month if needed.
 */
function getMonthlyPeriodStart(year: number, month: number, targetDay: number): dayjs.Dayjs {
  const d = dayjs.utc().year(year).month(month).date(1);
  const daysInMonth = d.daysInMonth();
  const clampedDay = Math.min(targetDay, daysInMonth);
  return d.date(clampedDay);
}

function computeMonthlyBoundaries(
  dayOfMonth: string,
  startDate: Date,
  endDate: Date,
): { periodStart: Date; periodEnd: Date }[] {
  const targetDay = parseInt(dayOfMonth, 10);
  const start = dayjs.utc(startDate);
  const end = dayjs.utc(endDate);

  // Find the first period start on or before startDate
  let year = start.year();
  let month = start.month(); // 0-indexed

  let periodStart = getMonthlyPeriodStart(year, month, targetDay);

  // If periodStart is after startDate, go back one month
  if (periodStart.isAfter(start, 'day')) {
    if (month === 0) {
      year -= 1;
      month = 11;
    } else {
      month -= 1;
    }
    periodStart = getMonthlyPeriodStart(year, month, targetDay);
  }

  const results: { periodStart: Date; periodEnd: Date }[] = [];

  while (true) {
    // Compute next period start
    let nextMonth = periodStart.month() + 1;
    let nextYear = periodStart.year();
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    const nextPeriodStart = getMonthlyPeriodStart(nextYear, nextMonth, targetDay);
    const periodEnd = nextPeriodStart.subtract(1, 'day');

    // Include period if it overlaps with [startDate, endDate]
    if (periodEnd.isBefore(start, 'day')) {
      periodStart = nextPeriodStart;
      continue;
    }

    if (periodStart.isAfter(end, 'day')) {
      break;
    }

    results.push({
      periodStart: periodStart.toDate(),
      periodEnd: periodEnd.toDate(),
    });

    periodStart = nextPeriodStart;
  }

  return results;
}

function computeYearlyBoundaries(
  mmdd: string,
  startDate: Date,
  endDate: Date,
): { periodStart: Date; periodEnd: Date }[] {
  const [mmStr, ddStr] = mmdd.split('/');
  const targetMonth = parseInt(mmStr, 10) - 1; // 0-indexed
  const targetDay = parseInt(ddStr, 10);
  const start = dayjs.utc(startDate);
  const end = dayjs.utc(endDate);

  // Find the first period start on or before startDate
  let year = start.year();
  let periodStart = dayjs.utc().year(year).month(targetMonth).date(targetDay).startOf('day');

  if (periodStart.isAfter(start, 'day')) {
    year -= 1;
    periodStart = dayjs.utc().year(year).month(targetMonth).date(targetDay).startOf('day');
  }

  const results: { periodStart: Date; periodEnd: Date }[] = [];

  while (true) {
    const nextPeriodStart = dayjs
      .utc()
      .year(periodStart.year() + 1)
      .month(targetMonth)
      .date(targetDay)
      .startOf('day');
    const periodEnd = nextPeriodStart.subtract(1, 'day');

    if (periodEnd.isBefore(start, 'day')) {
      periodStart = nextPeriodStart;
      continue;
    }

    if (periodStart.isAfter(end, 'day')) {
      break;
    }

    results.push({
      periodStart: periodStart.toDate(),
      periodEnd: periodEnd.toDate(),
    });

    periodStart = nextPeriodStart;
  }

  return results;
}
