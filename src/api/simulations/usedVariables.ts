import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadUsedVariables } from '../../utils/simulation/loadUsedVariables';

/**
 * Retrieves all variable names used across accounts and retirement plans.
 *
 * Analyzes accounts, transfers, social security, and pension configurations
 * to determine which variables are referenced in date fields and other
 * configurable properties.
 *
 * @param request - Express request object containing financial data
 * @returns Array of variable names used in the system
 *
 * @example
 * ```typescript
 * const usedVariables = getUsedVariables(request);
 * // Returns: [
 * //   "retirementDate",
 * //   "birthDate",
 * //   "careerStartDate",
 * //   "simulationEndDate"
 * // ]
 * ```
 */
export async function getUsedVariables(request: Request) {
  const data = await getData(request);
  return loadUsedVariables(data.accountsAndTransfers, data.socialSecurities, data.pensions);
}
