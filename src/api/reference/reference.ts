import { Request, Response } from 'express';
import { load, save } from '../../utils/io/io';

export async function getLifeInsuranceReferenceData(_req: Request, res: Response) {
  try {
    const historicRates = load<Record<string, unknown>>('historicRates.json');
    const premiumRates = load<Record<string, unknown>>('lifeInsurancePremiumRates.json');
    res.json({
      termLifePPI: (historicRates as Record<string, unknown>).termLifePPI ?? {},
      wholeLifePPI: (historicRates as Record<string, unknown>).wholeLifePPI ?? {},
      wholeLifeDividendScale: (historicRates as Record<string, unknown>).wholeLifeDividendScale ?? {},
      termRates: (premiumRates as Record<string, unknown>).term ?? [],
      wholeRates: (premiumRates as Record<string, unknown>).whole ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getExpectedReturns(_req: Request, res: Response) {
  try {
    const data = load<{ returns: Record<string, number> }>('expectedReturns.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateExpectedReturns(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'expectedReturns.json');
    res.json({ success: true });
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

export async function getTaxBracketsRaw(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('taxBrackets.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getWithholdingTablesRaw(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('federalWithholdingTables.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateCapitalGainsRates(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'capitalGainsRates.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateTaxBrackets(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'taxBrackets.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateWithholdingTables(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'federalWithholdingTables.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
