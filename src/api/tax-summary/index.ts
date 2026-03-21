import { Request } from 'express';

/**
 * GET /api/tax-summary?year=YYYY&simulationId=XXX
 * Returns the TaxReconciliation data for a given year.
 *
 * Currently a placeholder endpoint that indicates the feature is available.
 * The actual data integration will come when the tax data is available
 * from simulation results or deterministic calculations.
 */
export async function getTaxSummary(req: Request) {
  const year = parseInt(req.query.year as string);
  const simulationId = req.query.simulationId as string;

  if (!year || isNaN(year)) {
    throw new Error('year parameter required');
  }

  // TODO: Run a deterministic calculation for the given year
  // or retrieve from cached simulation results.
  // For now, return a placeholder structure indicating the feature is available.
  return {
    status: 'not_yet_available',
    message: 'Tax summary data will be available after running a simulation. This endpoint is a placeholder for the tax summary UI.',
    year,
    simulationId: simulationId || 'default',
    data: null,
  };
}
