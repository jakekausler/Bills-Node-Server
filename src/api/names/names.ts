import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { loadNameCategories } from '../../utils/names/names';

export async function getNameCategories(request: Request) {
  const data = await getData(request);
  return loadNameCategories(data.accountsAndTransfers);
}
