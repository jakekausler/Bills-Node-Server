export type SpendingTrackerCategory = {
  id: string; // UUID

  name: string; // e.g., "Eating Out", "Vacation" — must be unique

  // Base threshold (variable-capable, follows bill amount pattern)
  threshold: number; // e.g., 150 — must be >= 0
  thresholdIsVariable: boolean;
  thresholdVariable: string | null;

  // Interval
  interval: 'weekly' | 'monthly' | 'yearly';
  intervalStart: string; // Context-sensitive:
  //   weekly: day name ("Saturday", "Monday", etc.)
  //   monthly: day of month ("1" through "28") — clamped to last day of month for values > days in month
  //   yearly: "MM/DD" ("01/01", "06/15", etc.)

  // Target account for remainder bills
  accountId: string; // Account where remainder bills are placed — required

  // Carry settings
  carryOver: boolean; // Underspend credits roll forward to increase next period's effective threshold
  carryUnder: boolean; // Overspend debits roll forward indefinitely, reducing effective threshold to $0 until debt is fully absorbed

  // Threshold inflation (matches bill increaseBy pattern)
  increaseBy: number; // Annual increase rate as decimal (e.g., 0.03 for 3%)
  increaseByIsVariable: boolean;
  increaseByVariable: string | null;
  increaseByDate: string; // "MM/DD" format — anniversary date for annual compound increase

  // Threshold change dates (each entry replaces the threshold entirely)
  thresholdChanges: {
    date: string; // "YYYY-MM-DD" — full date
    dateIsVariable: boolean;
    dateVariable: string | null; // Resolves to a date variable
    newThreshold: number; // Must be >= 0
    newThresholdIsVariable: boolean;
    newThresholdVariable: string | null; // Resolves to an amount variable
    resetCarry: boolean; // If true, carry debt/credit resets to 0 at this date
  }[]; // Must be sorted chronologically; no overlapping dates
};

export type SpendingTrackerData = {
  categories: SpendingTrackerCategory[];
};
