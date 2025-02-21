import { Request } from 'express';
import { getData } from '../../utils/net/request';
import { getQuote, getHistory } from '../../utils/stocks/stocks';

export async function getSymbolHistory(req: Request) {
  const { startDate, endDate } = await getData(req);
  const symbol = req.params.symbol;
  return await getHistory(symbol, startDate, endDate);
}

export async function getSymbolQuote(req: Request) {
  const symbol = req.params.symbol;
  return await getQuote(symbol);
}
