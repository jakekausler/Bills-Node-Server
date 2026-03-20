import { readFile } from 'fs/promises';
import { join } from 'path';
import { MC_RESULTS_DIR, UUID_REGEX } from './paths';

export interface FailureHistogramResult {
  histogram: Array<{ year: string; count: number }>;
  summary: {
    totalSimulations: number;
    failedSimulations: number;
    medianFailureYear: number | null;
    earliestFailureYear: number | null;
    latestFailureYear: number | null;
  };
}

/**
 * Read MC results and compute a histogram of funding failure years.
 * Each simulation may have a `fundingFailureYear` (number | null).
 * We group non-null failure years by year and compute summary statistics.
 */
export async function computeFailureHistogram(simulationId: string): Promise<FailureHistogramResult> {
  if (!UUID_REGEX.test(simulationId)) {
    throw new Error('Invalid simulation ID format');
  }

  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);
  const fileData = JSON.parse(await readFile(resultsPath, 'utf8'));
  const results: Array<{ fundingFailureYear?: number | null }> = fileData.results ?? [];

  const totalSimulations = results.length;
  const failureYears: number[] = [];

  for (const r of results) {
    if (r.fundingFailureYear != null) {
      failureYears.push(r.fundingFailureYear);
    }
  }

  const failedSimulations = failureYears.length;

  if (failedSimulations === 0) {
    return {
      histogram: [],
      summary: {
        totalSimulations,
        failedSimulations: 0,
        medianFailureYear: null,
        earliestFailureYear: null,
        latestFailureYear: null,
      },
    };
  }

  // Count by year
  const counts = new Map<number, number>();
  for (const y of failureYears) {
    counts.set(y, (counts.get(y) ?? 0) + 1);
  }

  // Sort histogram by year
  const histogram = Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => ({ year: String(year), count }));

  // Summary stats
  failureYears.sort((a, b) => a - b);
  const earliestFailureYear = failureYears[0];
  const latestFailureYear = failureYears[failureYears.length - 1];

  // Median
  const mid = Math.floor(failureYears.length / 2);
  const medianFailureYear =
    failureYears.length % 2 === 1
      ? failureYears[mid]
      : Math.round((failureYears[mid - 1] + failureYears[mid]) / 2);

  return {
    histogram,
    summary: {
      totalSimulations,
      failedSimulations,
      medianFailureYear,
      earliestFailureYear,
      latestFailureYear,
    },
  };
}
