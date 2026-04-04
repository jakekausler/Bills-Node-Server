import { Request, Response } from 'express';
import { load } from '../../utils/io/io';

export async function getExpectedReturns(_req: Request, res: Response) {
  try {
    const data = load<{ returns: Record<string, number> }>('expectedReturns.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getCapitalGainsRates(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('capitalGainsRates.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
