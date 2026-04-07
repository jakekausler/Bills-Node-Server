// NOTE: historicRates.json is shared by multiple endpoints. Read-modify-write
// operations are NOT concurrency-safe. Acceptable for single-user operation.
// If multi-user access is needed, add file locking or migrate to database.
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

export async function updateLifeInsuranceReferenceData(req: Request, res: Response) {
  try {
    const { termLifePPI, wholeLifePPI, wholeLifeDividendScale, termRates, wholeRates } = req.body;
    const historicRates = load<Record<string, unknown>>('historicRates.json');
    historicRates.termLifePPI = termLifePPI;
    historicRates.wholeLifePPI = wholeLifePPI;
    historicRates.wholeLifeDividendScale = wholeLifeDividendScale;
    save(historicRates, 'historicRates.json');
    const premiumRates = load<Record<string, unknown>>('lifeInsurancePremiumRates.json');
    (premiumRates as Record<string, unknown>).term = termRates;
    (premiumRates as Record<string, unknown>).whole = wholeRates;
    save(premiumRates, 'lifeInsurancePremiumRates.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getLtcCosts(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('historicRates.json');
    res.json((data as Record<string, unknown>).costOfCare ?? {});
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateLtcCosts(req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('historicRates.json');
    (data as Record<string, unknown>).costOfCare = req.body;
    save(data, 'historicRates.json');
    res.json({ success: true });
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

export async function getBendPoints(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('bendPoints.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateBendPoints(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'bendPoints.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getWageIndex(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('averageWageIndex.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateWageIndex(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'averageWageIndex.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getIrmaaBrackets(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('irmaaBrackets.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateIrmaaBrackets(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'irmaaBrackets.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getMortality(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('ssaLifeTable.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateMortality(req: Request, res: Response) {
  try {
    const data = req.body;
    save(data, 'ssaLifeTable.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function getMarketReturns(_req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('historicRates.json');
    res.json((data as Record<string, unknown>).investment ?? {});
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}

export async function updateMarketReturns(req: Request, res: Response) {
  try {
    const data = load<Record<string, unknown>>('historicRates.json');
    (data as Record<string, unknown>).investment = req.body;
    save(data, 'historicRates.json');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}
