import { PortfolioComposition, PortfolioMakeupOverTime } from './types';

/**
 * Look up the portfolio composition for a given date from the glide path data.
 * Uses the most recent waypoint that is <= the given year.
 * Clamps to the earliest/latest waypoint if the year is outside the range.
 */
export function getPortfolioComposition(
  portfolioMakeup: PortfolioMakeupOverTime,
  date: Date,
): PortfolioComposition {
  const year = date.getUTCFullYear();
  const yearStr = year.toString();

  if (portfolioMakeup[yearStr]) {
    return portfolioMakeup[yearStr];
  }

  const years = Object.keys(portfolioMakeup)
    .map(Number)
    .sort((a, b) => a - b);

  if (year < years[0]) {
    return portfolioMakeup[years[0].toString()];
  }

  if (year > years[years.length - 1]) {
    return portfolioMakeup[years[years.length - 1].toString()];
  }

  let prevYear = years[0];
  for (const y of years) {
    if (y > year) {
      break;
    }
    prevYear = y;
  }

  return portfolioMakeup[prevYear.toString()];
}

/**
 * Compute a blended portfolio return from individual asset-class returns
 * and the portfolio composition at a given date.
 */
export function computeBlendedReturn(
  composition: PortfolioComposition,
  stockReturn: number,
  bondReturn: number,
  cashReturn: number,
): number {
  return (
    stockReturn * (composition.stock || 0) +
    bondReturn * (composition.bond || 0) +
    cashReturn * (composition.cash || 0) +
    // For preferred/convertible/other, use a simple stock/bond average as proxy
    ((stockReturn + bondReturn) / 2) * (composition.preferred || 0) +
    ((stockReturn + bondReturn) / 2) * (composition.convertible || 0) +
    ((stockReturn + bondReturn) / 2) * (composition.other || 0)
  );
}
