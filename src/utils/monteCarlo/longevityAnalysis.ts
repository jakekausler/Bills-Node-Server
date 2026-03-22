import { readFileSync } from 'fs';
import { join } from 'path';
import { MC_RESULTS_DIR } from './paths';

export interface LongevityDataPoint {
  age: number;
  survivalProbability: number; // % of sims with at least one survivor at this age
  fundedRatio: number; // % of surviving sims that never failed funding
  simCount: number; // Count of simulations with survivors at this age
  survivingSimCount: number; // Of those, how many never failed
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
 * Check if a person with given death date was alive at a given age
 * Ages are calculated from an assumed reference year and birth year
 */
function wasAliveAtAge(
  deathDateStr: string | null,
  age: number,
  simulationStartYear: number,
  simulationEndYear: number,
  birthYear: number,
): boolean {
  // Year when person reached this age
  const yearAtAge = birthYear + age;

  // If year at age is after simulation end, person never reached that age in this sim
  if (yearAtAge > simulationEndYear) {
    return false;
  }

  // If no death date, person survived the simulation and was alive at this age
  if (!deathDateStr) {
    // Person alive at end of sim, and reached this age within sim timeframe
    return yearAtAge <= simulationEndYear;
  }

  // Person has a death date — check if they reached this age before death
  const deathYear = parseInt(deathDateStr.substring(0, 4), 10);

  // Alive at age if: year at age is before death year
  return yearAtAge < deathYear;
}

/**
 * #14: Compute longevity analysis data — funded ratio and survival probability by age
 * For each age 65-100:
 * - Count simulations with at least one survivor at that age
 * - Of those, count how many had no funding failures
 * - Return survival probability and funded ratio
 */
export async function computeLongevityAnalysis(simulationId: string): Promise<LongevityDataPoint[]> {
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

    // Infer birth years from persons in death dates
    const birthYears: Map<string, number> = new Map();
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
      // Assume primary person born 65 years before sim start
      birthYears.set('Primary', simStartYear - 65);
      birthYears.set('Spouse', simStartYear - 63);
    }

    const longevityData: LongevityDataPoint[] = [];

    // For each age from 65 to 100
    for (let age = 65; age <= 100; age++) {
      let simsWithSurvivor = 0;
      let survivingSimsNotFailed = 0;

      // Check each simulation
      for (const sim of results) {
        const deathDates = sim.deathDates || {};
        let hasAnyoneSurviving = false;

        // Check if any person was alive at this age
        for (const [person, deathDateStr] of Object.entries(deathDates)) {
          const birthYear = birthYears.get(person) || (simStartYear - 65);
          if (wasAliveAtAge(deathDateStr as string | null, age, simStartYear, simEndYear, birthYear)) {
            hasAnyoneSurviving = true;
            break;
          }
        }

        if (hasAnyoneSurviving) {
          simsWithSurvivor++;

          // Check if this sim had no funding failure
          if (sim.fundingFailureYear === null || sim.fundingFailureYear === undefined) {
            survivingSimsNotFailed++;
          }
        }
      }

      const survivalProbability = simsWithSurvivor > 0 ? simsWithSurvivor / results.length : 0;
      const fundedRatio = simsWithSurvivor > 0 ? survivingSimsNotFailed / simsWithSurvivor : 0;

      longevityData.push({
        age,
        survivalProbability,
        fundedRatio,
        simCount: simsWithSurvivor,
        survivingSimCount: survivingSimsNotFailed,
      });
    }

    return longevityData;
  } catch (error) {
    throw new Error(`Failed to compute longevity analysis: ${error}`);
  }
}
