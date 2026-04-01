import { readFileSync } from 'fs';
import { join } from 'path';
import { MC_RESULTS_DIR } from './paths';

export interface LongevityDataPoint {
  age: number;
  survivalProbability: number; // % of sims with at least one survivor at this age
  fundedRatio: number; // % of surviving sims that never failed funding
  simCount: number; // Count of simulations with survivors at this age
  survivingSimCount: number; // Of those, how many never failed
  personSurvival?: Record<string, number>; // Per-person survival probability
  personBirthYears?: Record<string, number>; // Birth years for each person
}

/**
 * Extract birth year from a person's name or return null
 * Simple heuristic: look for persons in the data and assume they start at simulation start year
 * This is a placeholder — in practice, we'd get birth years from simulation config
 */
function extractBirthYear(deathDateStr: string | null, simulationYear: number): number | null {
  if (!deathDateStr) {
    // Person alive at end of sim — assume born ~65 years before sim end
    return simulationYear - 65;
  }
  const deathYear = parseInt(deathDateStr.substring(0, 4), 10);
  // Assume ~80 year lifespan (rough heuristic)
  return deathYear - 80;
}

/**
 * Check if a person with given death date was alive at a given calendar year
 */
function wasAliveAtYear(
  deathDateStr: string | null,
  calendarYear: number,
  simulationEndYear: number,
): boolean {
  if (calendarYear > simulationEndYear) return false;
  if (!deathDateStr) return calendarYear <= simulationEndYear;
  const deathYear = parseInt(deathDateStr.substring(0, 4), 10);
  return calendarYear < deathYear;
}

/**
 * #14: Compute longevity analysis data — funded ratio and survival probability by age
 * For each age 65-100:
 * - Count simulations with at least one survivor at that age
 * - Of those, count how many had no funding failures
 * - Return survival probability and funded ratio
 */
export async function computeLongevityAnalysis(simulationId: string, personBirthYears?: Record<string, number>): Promise<LongevityDataPoint[]> {
  const resultsPath = join(MC_RESULTS_DIR, `${simulationId}.json`);

  try {
    const resultsData = readFileSync(resultsPath, 'utf8');
    const fileData = JSON.parse(resultsData);

    const results = fileData.results || [];
    const metadata = fileData.metadata || {};

    if (results.length === 0) {
      throw new Error('No simulation data found');
    }

    // Get simulation start and end years from metadata
    const startDate = new Date(metadata.startDate || new Date());
    const endDate = new Date(metadata.endDate || new Date());
    const simStartYear = startDate.getUTCFullYear();
    const simEndYear = endDate.getUTCFullYear();

    // Use provided birth years if available, otherwise fall back to heuristic
    const birthYears: Map<string, number> = new Map();
    if (personBirthYears && Object.keys(personBirthYears).length > 0) {
      for (const [person, year] of Object.entries(personBirthYears)) {
        birthYears.set(person, year);
      }
    } else {
      // Infer birth years from persons in death dates (heuristic fallback)
      for (const sim of results) {
        const deathDates = sim.deathDates || {};
        for (const [person, deathDateStr] of Object.entries(deathDates)) {
          if (!birthYears.has(person)) {
            const birthYear = extractBirthYear(deathDateStr as string | null, simStartYear);
            if (birthYear !== null) {
              birthYears.set(person, birthYear);
            }
          }
        }
      }

      // If we couldn't extract birth years, use a default assumption
      if (birthYears.size === 0) {
        birthYears.set('Primary', simStartYear - 65);
        birthYears.set('Spouse', simStartYear - 63);
      }
    }

    const longevityData: LongevityDataPoint[] = [];

    // Calculate age range from simulation dates and primary person's birth year
    // Use the oldest person (lowest birth year) as primary for age axis
    let primaryBirthYear = Infinity;
    for (const [, year] of birthYears) {
      if (year < primaryBirthYear) {
        primaryBirthYear = year;
      }
    }
    if (primaryBirthYear === Infinity) primaryBirthYear = simStartYear - 65;
    const startAge = simStartYear - primaryBirthYear;
    const endAge = simEndYear - primaryBirthYear;

    // For each age within the simulation date range
    for (let age = startAge; age <= endAge; age++) {
      let simsWithSurvivor = 0;
      let survivingSimsNotFailed = 0;
      const personSurvival: Record<string, number> = {};

      // Initialize per-person counters
      for (const personName of birthYears.keys()) {
        personSurvival[personName] = 0;
      }

      // Check each simulation
      for (const sim of results) {
        const deathDates = sim.deathDates || {};
        let hasAnyoneSurviving = false;

        // Calculate calendar year from primary birth year + age
        const calendarYear = primaryBirthYear + age;

        // Check if any person was alive at this calendar year and count per-person
        for (const [person, deathDateStr] of Object.entries(deathDates)) {
          if (wasAliveAtYear(deathDateStr as string | null, calendarYear, simEndYear)) {
            hasAnyoneSurviving = true;
            // Track per-person survival
            if (personSurvival[person] !== undefined) {
              personSurvival[person]++;
            }
          }
        }

        if (hasAnyoneSurviving) {
          simsWithSurvivor++;

          // Check if this sim hasn't failed BY this specific calendar year
          const notFailedByAge = sim.fundingFailureYear == null || sim.fundingFailureYear > calendarYear;
          if (notFailedByAge) {
            survivingSimsNotFailed++;
          }
        }
      }

      const survivalProbability = simsWithSurvivor > 0 ? simsWithSurvivor / results.length : 0;
      const fundedRatio = simsWithSurvivor > 0 ? survivingSimsNotFailed / simsWithSurvivor : 0;

      // Convert per-person counts to probabilities
      const personSurvivalProbs = Object.fromEntries(
        Object.entries(personSurvival).map(([person, count]) => [
          person,
          results.length > 0 ? count / results.length : 0,
        ]),
      );

      longevityData.push({
        age,
        survivalProbability,
        fundedRatio,
        simCount: simsWithSurvivor,
        survivingSimCount: survivingSimsNotFailed,
        personSurvival: personSurvivalProbs,
        personBirthYears: Object.fromEntries(birthYears),
      });
    }

    return longevityData;
  } catch (error) {
    throw new Error(`Failed to compute longevity analysis: ${error}`);
  }
}
