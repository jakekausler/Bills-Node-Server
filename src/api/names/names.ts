import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadNameCategories } from '../../utils/names/names';

/**
 * Retrieves name-to-category mappings based on financial data analysis
 * 
 * This endpoint analyzes all activities and bills across accounts and transfers
 * to determine the most frequently used category for each transaction name.
 * This is useful for auto-categorization and pattern recognition.
 * 
 * @param request - Express request object with optional query parameters
 * @returns Object mapping transaction names to their most frequent categories
 */
export async function getNameCategories(request: Request) {
  const data = await getData(request);
  return loadNameCategories(data.accountsAndTransfers);
}
