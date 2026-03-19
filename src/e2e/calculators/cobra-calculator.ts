/**
 * Shadow calculator for COBRA premium logic.
 * No engine imports -- all data passed as parameters.
 */

/**
 * Calculate the monthly COBRA premium for a given year.
 * COBRA = basePremium * 1.02, inflated at 5% healthcare CPI from 2026.
 *
 * @param year - The year for which to calculate the premium
 * @param basePremium2026 - The base employer premium in 2026 (e.g. 1124.32)
 * @returns Monthly COBRA premium
 */
export function calculateCobraPremium(year: number, basePremium2026: number): number {
  const cobraPremium = basePremium2026 * 1.02;

  if (year <= 2026) {
    return Math.round(cobraPremium * 100) / 100;
  }

  // Inflate forward from 2026 at 5% healthcare CPI per year
  let inflated = cobraPremium;
  for (let y = 2027; y <= year; y++) {
    inflated *= 1.05;
  }

  return Math.round(inflated * 100) / 100;
}

/**
 * Determine whether a date falls within the COBRA coverage period
 * (first 18 months after retirement).
 *
 * @param retirementDate - ISO date string (YYYY-MM-DD) of retirement
 * @param currentDate - ISO date string (YYYY-MM-DD) to check
 * @returns True if currentDate is within 18 months after retirementDate
 */
export function isCobraPeriod(retirementDate: string, currentDate: string): boolean {
  const retire = new Date(retirementDate + 'T00:00:00Z');
  const current = new Date(currentDate + 'T00:00:00Z');

  // Calculate months elapsed (same approach as dayjs diff 'month')
  const yearDiff = current.getUTCFullYear() - retire.getUTCFullYear();
  const monthDiff = current.getUTCMonth() - retire.getUTCMonth();
  let totalMonths = yearDiff * 12 + monthDiff;

  // dayjs diff truncates toward zero: if the day-of-month hasn't been reached,
  // subtract one month (matches dayjs.utc(current).diff(dayjs.utc(retire), 'month'))
  if (current.getUTCDate() < retire.getUTCDate()) {
    totalMonths -= 1;
  }

  return totalMonths < 18;
}
