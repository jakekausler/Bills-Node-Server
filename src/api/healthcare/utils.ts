/**
 * Determine which plan year a given date falls into based on reset date.
 */
export function getPlanYear(date: Date, resetMonth: number, resetDay: number): number {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  // Check if date is before reset date in this calendar year
  const beforeReset =
    month < resetMonth || (month === resetMonth && day < resetDay);

  // If before reset, we're still in previous plan year
  return beforeReset ? year - 1 : year;
}
