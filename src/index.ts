import express, { Express, NextFunction, Request, Response } from 'express';
import { DateString } from './utils/date/types';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { appendFile } from 'fs/promises';
import { getSimpleAccounts, addAccount, updateAccounts, loadPortfolioConfigs, savePortfolioConfigs } from './api/accounts/accounts';
import { getAccount, updateAccount, removeAccount } from './api/accounts/account';
import { getGraphForAccounts } from './api/accounts/graph';
import { getTodayBalance } from './api/accounts/todayBalance';
import { getAccountGraph } from './api/accounts/graph';
import { getAccountActivity, addActivity } from './api/accounts/activity/activity';
import {
  getSpecificActivity,
  updateSpecificActivity,
  deleteSpecificActivity,
  changeAccountForActivity,
} from './api/accounts/activity/specificActivity';
import { getAccountBills, addBill } from './api/accounts/bills/bills';
import { getAllBills, bulkDeleteBills, bulkChangeBillAccount } from './api/bills/bills';
import {
  getSpecificBill,
  updateSpecificBill,
  deleteSpecificBill,
  changeAccountForBill,
} from './api/accounts/bills/bill';
import { getAccountInterests, addInterest, updateInterest } from './api/accounts/interests/interests';
import { getSpecificInterest, updateSpecificInterest, deleteSpecificInterest } from './api/accounts/interests/interest';
import { getCalendarBills } from './api/calendar/bills';
import { getConsolidatedActivity } from './api/accounts/consolidatedActivity/consolidatedActivity';
import { getSpecificConsolidatedActivity } from './api/accounts/consolidatedActivity/specificConsolidatedActivity';
import { getCategories, addCategory, deleteCategory, renameCategory } from './api/categories/categories';
import { getCategoryBreakdown } from './api/categories/breakdown';
import { getCategoryUsage } from './api/categories/usage';
import { getCategorySectionItemTransactions } from './api/categories/section/item/transactions';
import { getSimulations, updateSimulations } from './api/simulations/simulations';
import { getUsedVariables } from './api/simulations/usedVariables';
import { getSimulationOverridesHandler, updateSimulationOverridesHandler } from './api/simulations/overrides';
import { getNameCategories } from './api/names/names';
import { getFlow } from './api/flow/flow';
import { getCategorySectionTransactions } from './api/categories/section/transactions';
import { getCategorySectionBreakdown } from './api/categories/section/breakdown';
import {
  startSimulation,
  getSimulationStatus,
  getAllSimulations,
  getSimulationGraph,
  getSimulationResults,
  getSimulationResultByNumber,
  deleteSimulation,
  clearAllGraphCache,
  getFailureHistogram,
  getWorstCases,
  getIncomeExpense,
  getLongevityData,
  getSequenceOfReturns,
} from './api/monteCarlo/monteCarlo';
import { getHealthcareProgress } from './api/healthcare/progress';
import { getHealthcareExpenses } from './api/healthcare/expenses';
import { getHealthcareProgressHistory } from './api/healthcare/progressHistory';
import { getHealthcareProjections } from './api/healthcare/projections';
import { getRetirementProjections } from './api/retirement/projections';
import { clearProjectionsCache } from './utils/io/projectionsCache';
import bcrypt from 'bcrypt';
import mysql from 'mysql';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import { getMoneyMovementChart } from './api/moneyMovement/movement';
import { loadHealthcareConfigs, saveHealthcareConfigs } from './utils/io/healthcareConfigs';
import { loadAllHealthcareConfigs } from './utils/io/virtualHealthcarePlans';
import { loadTaxProfile, saveTaxProfile } from './utils/io/taxProfile';
import { loadTaxScenario, saveTaxScenario } from './utils/io/taxScenario';
import { loadRawPensionAndSS, savePensionAndSS, loadPensionsAndSocialSecurity } from './utils/io/retirement';
import { loadRMDTable, saveRMDTable, loadRothConversionConfigs, saveRothConversionConfigs, RothConversionConfigData } from './utils/io/rmdAndRothConversion';
import { loadVariable } from './utils/simulation/variable';
import { v4 as uuidv4 } from 'uuid';
import { clearDataCache } from './utils/io/dataCache';
import { DebugLogger } from './utils/calculate-v3/debug-logger';
import { CacheManager } from './utils/calculate-v3/cache';
import { clearRetirementCache, RetirementManager } from './utils/calculate-v3/retirement-manager';
import { SocialSecurity } from './data/retirement/socialSecurity/socialSecurity';
import { clearAcaCache } from './utils/calculate-v3/aca-manager';
import { clearMedicareCache } from './utils/calculate-v3/medicare-manager';
import { clearContributionLimitCache } from './utils/calculate-v3/contribution-limit-manager';
import { clearGlidePathCache } from './utils/calculate-v3/glide-path-blender';
import { load, save } from './utils/io/io';
import {
  getSpendingTrackerCategories,
  getSpendingTrackerCategory,
  createSpendingTrackerCategory,
  updateSpendingTrackerCategory,
  deleteSpendingTrackerCategory,
  getSpendingTrackerChartData,
  ApiError,
} from './api/spendingTracker/spendingTracker';
import { getTaxSummary } from './api/tax-summary';
import { getTaxDetail } from './api/tax/detail';
import { computeNetPay } from './utils/calculate-v3/compute-net-pay';
import { getBracketDataForYear } from './utils/calculate-v3/bracket-calculator';
import { getPersonBirthDate } from './api/person-config/person-config';
import type { PaycheckProfile } from './data/bill/paycheck-types';
import { importQfx, importCsv, getLedger, getPositions } from './api/portfolio/import';
import { getExpectedReturns, updateExpectedReturns, getCapitalGainsRates, updateCapitalGainsRates, getTaxBracketsRaw, updateTaxBrackets, getWithholdingTablesRaw, updateWithholdingTables, getLifeInsuranceReferenceData, updateLifeInsuranceReferenceData, getLtcCosts, updateLtcCosts, getBendPoints, updateBendPoints, getWageIndex, updateWageIndex, getIrmaaBrackets, updateIrmaaBrackets, getMortality, updateMortality, getMarketReturns, updateMarketReturns } from './api/reference/reference';
import { getPriceEndpoint, getCurrentPricesEndpoint, refreshPricesEndpoint, getPriceHistoryEndpoint, overridePriceEndpoint, deletePriceOverrideEndpoint, getPriceOverridesEndpoint } from './api/portfolio/prices';
import { addTransaction, listTransactions, editTransaction, deleteTransaction } from './api/portfolio/transactions';
import { reconcileHoldings } from './api/portfolio/reconcile';
import { getFundMetadata, updateFundMetadata } from './api/portfolio/fund-metadata';
import { getAssets, addAsset, updateAsset, deleteAsset } from './api/assets/assets';
import { getLifeInsurancePolicies, createLifeInsurancePolicy, updateLifeInsurancePolicy, deleteLifeInsurancePolicy } from './api/insurance/life-insurance';
import { getPersonConfigsHandler, createPersonConfig, updatePersonConfigs, deletePersonConfig } from './api/person-config/person-config';
import { getRatesConfigHandler, updateRatesConfigHandler } from './api/rates-config/rates-config';
import { getMCMappingsHandler, updateMCMappingsHandler } from './api/mc-mappings/mc-mappings';
import { getLTCConfigs, updateLTCConfigs, getLTCTransitions, updateLTCTransitions } from './api/insurance/ltc';
import { getInheritanceConfigs, updateInheritanceConfigs } from './api/inheritance/inheritance';
import { parseStatement } from './api/import/parse';
import { getImportMemory, updateImportMemory, deleteImportMemory } from './api/import/memory';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

if (!process.env.JWT_SECRET && process.env.DISABLE_AUTH !== 'true') {
  throw new Error('JWT_SECRET environment variable is required');
}

const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const apiErrorHandler = (fn: (req: Request) => Promise<any> | any) =>
  asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await fn(req));
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        res.status(e.statusCode).json({ error: e.message });
      } else {
        throw e;
      }
    }
  });

const app: Express = express();
const port = process.env.PORT || 5002;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Create MySQL connection pool at module level
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

interface DecodedToken {
  userId: number;
}

const isTokenValid = (token?: string) => {
  if (!token) {
    return false;
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as DecodedToken;
    return decoded.userId;
  } catch {
    return false;
  }
};

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  if (process.env.DISABLE_AUTH === 'true') {
    req.userId = 0;
    next();
    return;
  }
  const token = req.headers.authorization;
  const userId = isTokenValid(token);
  if (userId === false) {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }
  req.userId = userId as number;
  next();
};

// Account routes
app
  .route('/api/accounts')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getSimpleAccounts(req));
  }))
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await addAccount(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateAccounts(req));
  }));

// Account graph routes
app.get('/api/accounts/graph', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  if (req.query.debug === 'true') {
    const logger = new DebugLogger();
    // Store logger on request for downstream access
    (req as any)._debugLogger = logger;
    const result = await getGraphForAccounts(req);
    res.setHeader('X-Debug-Log', logger.getDir());
    logger.close();
    res.json(result);
    return;
  }
  res.json(await getGraphForAccounts(req));
}));

app.get('/api/accounts/:accountId/graph', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getAccountGraph(req));
}));

app
  .route('/api/accounts/:accountId')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getAccount(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateAccount(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await removeAccount(req));
  }));

// Account balance route
app.get('/api/accounts/:accountId/today_balance', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getTodayBalance(req));
}));

// Activity routes
app
  .route('/api/accounts/:accountId/activity')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getAccountActivity(req));
  }))
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await addActivity(req));
  }));

app
  .route('/api/accounts/:accountId/activity/:activityId')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getSpecificActivity(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateSpecificActivity(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteSpecificActivity(req));
  }));

app
  .route('/api/accounts/:accountId/activity/:activityId/change_account/:newAccountId')
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await changeAccountForActivity(req));
  }));

// Bill routes
app
  .route('/api/accounts/:accountId/bills')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getAccountBills(req));
  }))
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await addBill(req));
  }));

app
  .route('/api/accounts/:accountId/bills/:billId')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getSpecificBill(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateSpecificBill(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteSpecificBill(req));
  }));

app
  .route('/api/accounts/:accountId/bills/:billId/change_account/:newAccountId')
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await changeAccountForBill(req));
  }));

// Calendar routes
app.get('/api/calendar/bills', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCalendarBills(req));
}));

// Cross-account bills route
app.get('/api/bills', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getAllBills(req));
}));

app.route('/api/bills/bulk-delete').post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await bulkDeleteBills(req));
}));

app.route('/api/bills/bulk-change-account').post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await bulkChangeBillAccount(req));
}));

// Interest routes
app
  .route('/api/accounts/:accountId/interests')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getAccountInterests(req));
  }))
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await addInterest(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateInterest(req));
  }));

app
  .route('/api/accounts/:accountId/interests/:interestId')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getSpecificInterest(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateSpecificInterest(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteSpecificInterest(req));
  }));

// Consolidated activity routes
app.get('/api/accounts/:accountId/consolidated_activity', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getConsolidatedActivity(req));
}));

app.get(
  '/api/accounts/:accountId/consolidated_activity/:activityId',
  verifyToken,
  asyncHandler(async (req: Request, res: Response) => {
    res.json(await getSpecificConsolidatedActivity(req));
  }),
);

// Category routes
app
  .route('/api/categories')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getCategories(req));
  }))
  .post(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await addCategory(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await renameCategory(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteCategory(req));
  }));

app.get('/api/categories/breakdown', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCategoryBreakdown(req));
}));

app.get('/api/categories/usage', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCategoryUsage(req));
}));

app.get('/api/categories/:section/transactions', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCategorySectionTransactions(req));
}));

app.get('/api/categories/:section/breakdown', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCategorySectionBreakdown(req));
}));

app.get('/api/categories/:section/:item/transactions', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCategorySectionItemTransactions(req));
}));

// Simulation routes
app
  .route('/api/simulations')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getSimulations(req));
  }))
  .put(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateSimulations(req));
  }));

app.get('/api/simulations/used_variables', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getUsedVariables(req));
}));

app
  .route('/api/simulations/:name/overrides')
  .get(verifyToken, apiErrorHandler(getSimulationOverridesHandler))
  .put(verifyToken, apiErrorHandler(updateSimulationOverridesHandler));

// Name categories route
app.get('/api/names', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getNameCategories(req));
}));

// Persons endpoint (for UI person selectors)
app.get('/api/persons', verifyToken, asyncHandler(async (_req: Request, res: Response) => {
  const { getPersonNames } = await import('./utils/io/persons');
  res.json(getPersonNames());
}));

// Flow route
app.get('/api/flow', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getFlow(req));
}));

// Monte Carlo simulation routes
app.post('/api/monte_carlo/simulations', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await startSimulation(req));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getAllSimulations(req));
}));

app.get('/api/monte_carlo/simulations/:id/status', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getSimulationStatus(req));
  } catch (error) {
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/graph', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getSimulationGraph(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/failure-histogram', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getFailureHistogram(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/worst-cases', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getWorstCases(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/income-expense', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getIncomeExpense(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/longevity', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getLongevityData(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/sequence-of-returns', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getSequenceOfReturns(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/results', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getSimulationResults(req));
  } catch (error) {
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.get('/api/monte_carlo/simulations/:id/results/:simNumber', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getSimulationResultByNumber(req));
  } catch (error) {
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

app.delete('/api/monte_carlo/simulations/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await deleteSimulation(req));
  } catch (error) {
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}));

interface User {
  id: number;
  username: string;
  password: string;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' },
});

app.post('/api/auth/token', authLimiter, asyncHandler(async (req: Request, res: Response) => {
  if (process.env.DISABLE_AUTH === 'true') {
    const token = jwt.sign({ userId: 0 }, process.env.JWT_SECRET || 'dummy', { expiresIn: '30d' });
    res.json({ token });
    return;
  }
  const { username, password } = req.body;
  try {
    const query = promisify(pool.query).bind(pool);
    const results = (await query({
      sql: 'SELECT * FROM users WHERE username = ?',
      values: [username],
    })) as User[];
    const user = results[0];

    if (!user) {
      res.status(401).json({ token: 'INVALID' });
      return;
    }

    if (!(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ token: 'INVALID' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || '', { expiresIn: '30d' });

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(401).json({ token: 'INVALID' });
  }
}));

app.post('/api/auth/logout', verifyToken, (_req: Request, res: Response) => {
  res.json({ token: null });
});

app.get('/api/auth/validate', (req: Request, res: Response) => {
  if (process.env.DISABLE_AUTH === 'true') {
    res.json({ userId: 0 });
    return;
  }
  const token = req.headers.authorization;
  const userId = isTokenValid(token);
  if (!userId) {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }
  res.json({ token: userId });
});

app.get('/api/moneyMovement', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getMoneyMovementChart(req));
}));

// Healthcare config routes
app.get('/api/healthcare/configs', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const simulation = (req.query.simulation as string) || 'Default';
    const configs = loadAllHealthcareConfigs(simulation);
    // Resolve variable dates to actual values
    for (const config of configs) {
      if (config.startDateIsVariable && config.startDateVariable) {
        try {
          const resolved = loadVariable(config.startDateVariable, simulation);
          if (resolved instanceof Date) {
            config.startDate = resolved.toISOString().split('T')[0] as DateString;
          }
        } catch { /* variable not found, keep original */ }
      }
      if (config.endDateIsVariable && config.endDateVariable) {
        try {
          const resolved = loadVariable(config.endDateVariable, simulation);
          if (resolved instanceof Date) {
            config.endDate = resolved.toISOString().split('T')[0] as DateString;
          }
        } catch { /* variable not found, keep original */ }
      }
    }
    res.json(configs);
  } catch (error) {
    console.error('Error loading healthcare configs:', error);
    res.status(500).json({ error: 'Failed to load healthcare configs' });
  }
}));

app.post('/api/healthcare/configs', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    // Validate coveredPersons is a non-empty array
    if (!Array.isArray(req.body.coveredPersons) ||
        req.body.coveredPersons.length === 0 ||
        !req.body.coveredPersons.every((p: unknown) => typeof p === 'string' && p.trim().length > 0)) {
      return res.status(400).json({ error: 'coveredPersons must be a non-empty array of non-empty strings' });
    }

    // Validate required fields
    const requiredFields = [
      'name',
      'coveredPersons',
      'startDate',
      'individualDeductible',
      'individualOutOfPocketMax',
      'familyDeductible',
      'familyOutOfPocketMax',
      'resetMonth',
      'resetDay',
    ];

    const missingFields = requiredFields.filter(field => {
      if (field === 'startDate' && req.body.startDateIsVariable) return false;
      return req.body[field] === undefined || req.body[field] === null || req.body[field] === '';
    });

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const configs = await loadHealthcareConfigs();
    const {
      name,
      coveredPersons,
      policyholder,
      startDate,
      startDateIsVariable,
      startDateVariable,
      endDate,
      endDateIsVariable,
      endDateVariable,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId,
      hsaReimbursementEnabled,
      resetMonth,
      resetDay,
      monthlyPremium,
      monthlyPremiumInflationVariable,
      deductibleInflationVariable,
      deductibleInflationRate,
    } = req.body;
    const newConfig = {
      id: uuidv4(),
      name,
      coveredPersons,
      policyholder: policyholder ?? null,
      startDate,
      startDateIsVariable: startDateIsVariable ?? false,
      startDateVariable: startDateVariable ?? null,
      endDate: endDate ?? null,
      endDateIsVariable: endDateIsVariable ?? false,
      endDateVariable: endDateVariable ?? null,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId: hsaAccountId ?? null,
      hsaReimbursementEnabled: hsaReimbursementEnabled ?? false,
      resetMonth,
      resetDay,
      monthlyPremium: monthlyPremium ?? 0,
      monthlyPremiumInflationVariable: monthlyPremiumInflationVariable ?? undefined,
      deductibleInflationVariable: deductibleInflationVariable ?? undefined,
      deductibleInflationRate: deductibleInflationRate ?? 0.05,
    };
    configs.push(newConfig);
    await saveHealthcareConfigs(configs);
    res.json(newConfig);
  } catch (error) {
    console.error('Error creating healthcare config:', error);
    res.status(500).json({ error: 'Failed to create healthcare config' });
  }
}));

app.put('/api/healthcare/configs/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    // Validate coveredPersons is a non-empty array
    if (!Array.isArray(req.body.coveredPersons) ||
        req.body.coveredPersons.length === 0 ||
        !req.body.coveredPersons.every((p: unknown) => typeof p === 'string' && p.trim().length > 0)) {
      return res.status(400).json({ error: 'coveredPersons must be a non-empty array of non-empty strings' });
    }

    const configs = await loadHealthcareConfigs();
    const index = configs.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Config not found' });
    }
    const {
      name,
      coveredPersons,
      policyholder,
      startDate,
      startDateIsVariable,
      startDateVariable,
      endDate,
      endDateIsVariable,
      endDateVariable,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId,
      hsaReimbursementEnabled,
      resetMonth,
      resetDay,
      monthlyPremium,
      monthlyPremiumInflationVariable,
      deductibleInflationVariable,
      deductibleInflationRate,
    } = req.body;
    configs[index] = {
      id: req.params.id,
      name,
      coveredPersons,
      policyholder: policyholder ?? null,
      startDate,
      startDateIsVariable: startDateIsVariable ?? false,
      startDateVariable: startDateVariable ?? null,
      endDate: endDate ?? null,
      endDateIsVariable: endDateIsVariable ?? false,
      endDateVariable: endDateVariable ?? null,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId: hsaAccountId ?? null,
      hsaReimbursementEnabled: hsaReimbursementEnabled ?? false,
      resetMonth,
      resetDay,
      monthlyPremium: monthlyPremium ?? 0,
      monthlyPremiumInflationVariable: monthlyPremiumInflationVariable ?? undefined,
      deductibleInflationVariable: deductibleInflationVariable ?? undefined,
      deductibleInflationRate: deductibleInflationRate ?? 0.05,
    };
    await saveHealthcareConfigs(configs);
    res.json(configs[index]);
  } catch (error) {
    console.error('Error updating healthcare config:', error);
    res.status(500).json({ error: 'Failed to update healthcare config' });
  }
}));

app.delete('/api/healthcare/configs/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const configs = await loadHealthcareConfigs();
    const configExists = configs.some(c => c.id === req.params.id);

    if (!configExists) {
      return res.status(404).json({ error: 'Config not found' });
    }

    const filtered = configs.filter(c => c.id !== req.params.id);
    await saveHealthcareConfigs(filtered);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting healthcare config:', error);
    res.status(500).json({ error: 'Failed to delete healthcare config' });
  }
}));

app.get('/api/healthcare/progress', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const simulation = req.query.simulation as string;

    if (!simulation) {
      return res.status(400).json({ error: 'Simulation parameter required' });
    }

    const progress = await getHealthcareProgress(req);
    res.json(progress);
  } catch (error) {
    console.error('Error getting healthcare progress:', error);
    res.status(500).json({ error: 'Failed to get healthcare progress' });
  }
}));

app.get('/api/healthcare/expenses', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const simulation = req.query.simulation as string;

    if (!simulation) {
      return res.status(400).json({ error: 'Simulation parameter required' });
    }

    const expenses = await getHealthcareExpenses(req);
    res.json(expenses);
  } catch (error) {
    console.error('Error getting healthcare expenses:', error);
    res.status(500).json({ error: 'Failed to get healthcare expenses' });
  }
}));

app.get('/api/healthcare/progress-history', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const simulation = req.query.simulation as string;
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const configId = req.query.configId as string;

    if (!simulation) {
      return res.status(400).json({ error: 'Simulation parameter required' });
    }

    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate parameters required' });
    }

    if (!configId) {
      return res.status(400).json({ error: 'configId parameter required' });
    }

    const history = await getHealthcareProgressHistory(req);
    res.json(history);
  } catch (error) {
    console.error('Error getting healthcare progress history:', error);
    res.status(500).json({ error: 'Failed to get healthcare progress history' });
  }
}));

app.get('/api/healthcare/projections', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const simulation = req.query.simulation as string;

    if (!simulation) {
      return res.status(400).json({ error: 'Simulation parameter required' });
    }

    const projections = await getHealthcareProjections(req);
    res.json(projections);
  } catch (error) {
    console.error('Error getting healthcare projections:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get healthcare projections' });
  }
}));

// Spending Tracker routes
app
  .route('/api/spending-tracker')
  .get(verifyToken, apiErrorHandler(getSpendingTrackerCategories))
  .post(verifyToken, apiErrorHandler(createSpendingTrackerCategory));

app
  .route('/api/spending-tracker/:id')
  .get(verifyToken, apiErrorHandler(getSpendingTrackerCategory))
  .put(verifyToken, apiErrorHandler(updateSpendingTrackerCategory))
  .delete(verifyToken, apiErrorHandler(deleteSpendingTrackerCategory));

app.get('/api/spending-tracker/:id/chart-data', verifyToken, apiErrorHandler(getSpendingTrackerChartData));

// Tax Summary route
app.get('/api/tax-summary', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getTaxSummary(req));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to get tax summary' });
  }
}));

// Tax profile routes
app.get('/api/tax/profile', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const profile = loadTaxProfile();
    res.json(profile);
  } catch (error) {
    console.error('Error loading tax profile:', error);
    res.status(500).json({ error: 'Failed to load tax profile' });
  }
}));

app.put('/api/tax/profile', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { filingStatus, state, stateTaxRate, itemizationMode } = req.body;
    if (!filingStatus || !['single', 'mfj', 'mfs', 'hoh'].includes(filingStatus)) {
      return res.status(400).json({ error: 'Invalid filing status' });
    }
    if (!state || typeof state !== 'string') {
      return res.status(400).json({ error: 'State is required' });
    }
    if (typeof stateTaxRate !== 'number' || stateTaxRate < 0 || stateTaxRate > 1) {
      return res.status(400).json({ error: 'State tax rate must be between 0 and 1' });
    }
    if (!itemizationMode || !['standard', 'itemized', 'auto'].includes(itemizationMode)) {
      return res.status(400).json({ error: 'Invalid itemization mode' });
    }
    const profile = req.body;
    saveTaxProfile(profile);
    res.json(profile);
  } catch (error) {
    console.error('Error saving tax profile:', error);
    res.status(500).json({ error: 'Failed to save tax profile' });
  }
}));

// Tax brackets route
app.get('/api/tax/brackets', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const year = Number(req.query.year ?? new Date().getFullYear());
    const filingStatus = String(req.query.filingStatus ?? 'mfj') as 'single' | 'mfj' | 'mfs' | 'hoh';

    const yearData = getBracketDataForYear(year, filingStatus, 0.03);

    const brackets = yearData.brackets[filingStatus] ?? [];
    const standardDeduction = yearData.standardDeduction[filingStatus] ?? 0;

    res.json({ year, filingStatus, brackets, standardDeduction });
  } catch (error) {
    console.error('Error loading tax brackets:', error);
    res.status(500).json({ error: 'Failed to load tax brackets' });
  }
}));

// Withholding tables route
app.get('/api/tax/withholding-tables', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const year = Number(req.query.year ?? new Date().getFullYear());
    const filingStatus = String(req.query.filingStatus ?? 'mfj') as 'single' | 'mfj' | 'mfs' | 'hoh';
    const payPeriod = String(req.query.payPeriod ?? 'biweekly') as 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'annual';

    const PAY_PERIOD_DIVISORS: Record<string, number> = {
      weekly: 52,
      biweekly: 26,
      semimonthly: 24,
      monthly: 12,
      annual: 1,
    };
    const divisor = PAY_PERIOD_DIVISORS[payPeriod] ?? 26;

    // Read federalWithholdingTables.json directly (not getBracketDataForYear which projects future years)
    const tablesPath = path.join(__dirname, '../data/federalWithholdingTables.json');
    const rawData = JSON.parse(fs.readFileSync(tablesPath, 'utf-8'));

    // Find closest available year (use the latest year that is <= requested year)
    const availableYears = Object.keys(rawData).map(Number).sort((a, b) => a - b);
    const closestYear = availableYears.filter(y => y <= year).pop() ?? availableYears[0];

    const yearData = rawData[String(closestYear)];
    const category = yearData?.standard ?? yearData?.[Object.keys(yearData)[0]];
    const statusData = category?.[filingStatus];

    if (!statusData) {
      return res.status(404).json({ error: `No withholding data for filing status: ${filingStatus}` });
    }

    const scaleBracket = (b: { min: number; max: number | null; base: number; rate: number }) => ({
      min: b.min / divisor,
      max: b.max !== null ? b.max / divisor : null,
      base: b.base / divisor,
      rate: b.rate,
    });

    res.json({
      year: closestYear,
      filingStatus,
      payPeriod,
      periodsPerYear: divisor,
      standardDeduction: statusData.standardDeduction / divisor,
      brackets: statusData.brackets.map(scaleBracket),
    });
  } catch (error) {
    console.error('Error loading withholding tables:', error);
    res.status(500).json({ error: 'Failed to load withholding tables' });
  }
}));

app.get('/api/tax/scenario', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const scenario = loadTaxScenario();
    res.json(scenario);
  } catch (error) {
    console.error('Error loading tax scenario:', error);
    res.status(500).json({ error: 'Failed to load tax scenario' });
  }
}));

app.put('/api/tax/scenario', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const scenario = req.body as import('./utils/io/taxScenario').TaxScenario;
    saveTaxScenario(scenario);
    res.json(scenario);
  } catch (error) {
    console.error('Error saving tax scenario:', error);
    res.status(500).json({ error: 'Failed to save tax scenario' });
  }
}));

// Tax detail (reconciliation) route
app.get('/api/tax/detail/:year', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await getTaxDetail(req));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
}));

// ─── Helper: Transform pension/SS data for API responses ───
function toApiPriorIncome(incomes: number[], years: number[]): { year: number; amount: number }[] {
  return years.map((year, i) => ({ year, amount: incomes[i] ?? 0 }));
}

function fromApiPriorIncome(items: { year: number; amount: number }[]): { incomes: number[]; years: number[] } {
  const sorted = [...items].sort((a, b) => a.year - b.year);
  return {
    incomes: sorted.map((i) => i.amount),
    years: sorted.map((i) => i.year),
  };
}

// ─── Pension Routes ───

// GET /api/pensions — list all pensions
app.get('/api/pensions', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const pensions = data.pensions.map((p) => ({
      ...p,
      priorIncome: toApiPriorIncome(p.priorAnnualNetIncomes, p.priorAnnualNetIncomeYears),
    }));
    res.json(pensions);
  } catch (error) {
    console.error('Error loading pensions:', error);
    res.status(500).json({ error: 'Failed to load pensions' });
  }
}));

// GET /api/pensions/:id — get single pension
app.get('/api/pensions/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const pension = data.pensions.find((p) => p.id === req.params.id);
    if (!pension) return res.status(404).json({ error: 'Pension not found' });
    res.json({
      ...pension,
      priorIncome: toApiPriorIncome(pension.priorAnnualNetIncomes, pension.priorAnnualNetIncomeYears),
    });
  } catch (error) {
    console.error('Error loading pension:', error);
    res.status(500).json({ error: 'Failed to load pension' });
  }
}));

// POST /api/pensions — create pension
app.post('/api/pensions', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const { priorIncome, ...rest } = req.body;
    const { incomes, years } = fromApiPriorIncome(priorIncome || []);
    const newPension = {
      id: uuidv4(),
      ...rest,
      priorAnnualNetIncomes: incomes,
      priorAnnualNetIncomeYears: years,
    };
    data.pensions.push(newPension);
    savePensionAndSS(data);
    clearRetirementCache();
    clearProjectionsCache();
    res.json({
      ...newPension,
      priorIncome: toApiPriorIncome(newPension.priorAnnualNetIncomes, newPension.priorAnnualNetIncomeYears),
    });
  } catch (error) {
    console.error('Error creating pension:', error);
    res.status(500).json({ error: 'Failed to create pension' });
  }
}));

// PUT /api/pensions/:id — update pension
app.put('/api/pensions/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const index = data.pensions.findIndex((p) => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Pension not found' });
    const { priorIncome, ...rest } = req.body;
    const { incomes, years } = fromApiPriorIncome(priorIncome || []);
    data.pensions[index] = {
      ...data.pensions[index],
      ...rest,
      id: req.params.id, // preserve id
      priorAnnualNetIncomes: incomes,
      priorAnnualNetIncomeYears: years,
    };
    savePensionAndSS(data);
    clearRetirementCache();
    clearProjectionsCache();
    res.json({
      ...data.pensions[index],
      priorIncome: toApiPriorIncome(data.pensions[index].priorAnnualNetIncomes, data.pensions[index].priorAnnualNetIncomeYears),
    });
  } catch (error) {
    console.error('Error updating pension:', error);
    res.status(500).json({ error: 'Failed to update pension' });
  }
}));

// DELETE /api/pensions/:id — delete pension
app.delete('/api/pensions/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const index = data.pensions.findIndex((p) => p.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Pension not found' });
    data.pensions.splice(index, 1);
    savePensionAndSS(data);
    clearRetirementCache();
    clearProjectionsCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting pension:', error);
    res.status(500).json({ error: 'Failed to delete pension' });
  }
}));

// ─── Social Security Routes ───

// GET /api/social-securities — list all
app.get('/api/social-securities', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const ssList = data.socialSecurities.map((ss) => ({
      ...ss,
      priorIncome: toApiPriorIncome(ss.priorAnnualNetIncomes, ss.priorAnnualNetIncomeYears),
    }));
    res.json(ssList);
  } catch (error) {
    console.error('Error loading social securities:', error);
    res.status(500).json({ error: 'Failed to load social securities' });
  }
}));

// GET /api/social-securities/:id — get single
app.get('/api/social-securities/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const ss = data.socialSecurities.find((s) => s.id === req.params.id);
    if (!ss) return res.status(404).json({ error: 'Social Security config not found' });
    res.json({
      ...ss,
      priorIncome: toApiPriorIncome(ss.priorAnnualNetIncomes, ss.priorAnnualNetIncomeYears),
    });
  } catch (error) {
    console.error('Error loading social security:', error);
    res.status(500).json({ error: 'Failed to load social security' });
  }
}));

// POST /api/social-securities — create
app.post('/api/social-securities', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const { priorIncome, ...rest } = req.body;
    const { incomes, years } = fromApiPriorIncome(priorIncome || []);
    const newSS = {
      id: uuidv4(),
      ...rest,
      priorAnnualNetIncomes: incomes,
      priorAnnualNetIncomeYears: years,
    };
    data.socialSecurities.push(newSS);
    savePensionAndSS(data);
    clearRetirementCache();
    clearProjectionsCache();
    res.json({
      ...newSS,
      priorIncome: toApiPriorIncome(newSS.priorAnnualNetIncomes, newSS.priorAnnualNetIncomeYears),
    });
  } catch (error) {
    console.error('Error creating social security:', error);
    res.status(500).json({ error: 'Failed to create social security' });
  }
}));

// PUT /api/social-securities/:id — update
app.put('/api/social-securities/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const index = data.socialSecurities.findIndex((s) => s.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Social Security config not found' });
    const { priorIncome, ...rest } = req.body;
    const { incomes, years } = fromApiPriorIncome(priorIncome || []);
    data.socialSecurities[index] = {
      ...data.socialSecurities[index],
      ...rest,
      id: req.params.id,
      priorAnnualNetIncomes: incomes,
      priorAnnualNetIncomeYears: years,
    };
    savePensionAndSS(data);
    clearRetirementCache();
    clearProjectionsCache();
    res.json({
      ...data.socialSecurities[index],
      priorIncome: toApiPriorIncome(
        data.socialSecurities[index].priorAnnualNetIncomes,
        data.socialSecurities[index].priorAnnualNetIncomeYears,
      ),
    });
  } catch (error) {
    console.error('Error updating social security:', error);
    res.status(500).json({ error: 'Failed to update social security' });
  }
}));

// DELETE /api/social-securities/:id — delete
app.delete('/api/social-securities/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const data = loadRawPensionAndSS();
    const index = data.socialSecurities.findIndex((s) => s.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Social Security config not found' });
    data.socialSecurities.splice(index, 1);
    savePensionAndSS(data);
    clearRetirementCache();
    clearProjectionsCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting social security:', error);
    res.status(500).json({ error: 'Failed to delete social security' });
  }
}));

// GET /api/social-securities/:id/estimate — compute benefit estimates at 62/FRA/70
app.get('/api/social-securities/:id/estimate', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const simulation = (req.query.simulation as string) || 'Default';
    const data = loadRawPensionAndSS();
    const raw = data.socialSecurities.find((s) => s.id === req.params.id);
    if (!raw) return res.status(404).json({ error: 'Social Security config not found' });

    // Build a SocialSecurity instance for this simulation context
    const retirement = loadPensionsAndSocialSecurity(simulation);
    const ss = retirement.socialSecurities.find((s) => s.name === raw.name);
    if (!ss) return res.status(404).json({ error: 'Could not resolve Social Security config for simulation' });

    // Build a RetirementManager seeded with this SS's prior income
    const mgr = new RetirementManager([ss], []);
    const estimates = mgr.computeBenefitEstimates(ss);

    res.json({
      id: raw.id,
      name: raw.name,
      fra: estimates.fra,
      monthlyAt62: Math.round(estimates.at62),
      monthlyAtFRA: Math.round(estimates.atFRA),
      monthlyAt70: Math.round(estimates.at70),
      annualAt62: Math.round(estimates.at62 * 12),
      annualAtFRA: Math.round(estimates.atFRA * 12),
      annualAt70: Math.round(estimates.at70 * 12),
      spouseName: raw.spouseName ?? null,
    });
  } catch (err) {
    console.error('SS estimate error:', err);
    res.status(500).json({ error: 'Failed to compute benefit estimate' });
  }
}));

// ─── RMD Routes ───

// GET /api/retirement/rmd — return full RMD table
app.get('/api/retirement/rmd', verifyToken, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const table = loadRMDTable();
    res.json(table);
  } catch (error) {
    console.error('Error loading RMD table:', error);
    res.status(500).json({ error: 'Failed to load RMD table' });
  }
}));

// PUT /api/retirement/rmd — replace full RMD table
app.put('/api/retirement/rmd', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const table = req.body as Record<string, number>;
    saveRMDTable(table);
    res.json(table);
  } catch (error) {
    console.error('Error saving RMD table:', error);
    res.status(500).json({ error: 'Failed to save RMD table' });
  }
}));

// ─── Roth Conversion Routes ───

// GET /api/retirement/roth-conversion — list all configs (with UUID migration)
app.get('/api/retirement/roth-conversion', verifyToken, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const configs = loadRothConversionConfigs();
    res.json(configs);
  } catch (error) {
    console.error('Error loading Roth conversion configs:', error);
    res.status(500).json({ error: 'Failed to load Roth conversion configs' });
  }
}));

// PUT /api/retirement/roth-conversion — replace full configs array
app.put('/api/retirement/roth-conversion', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const configs = req.body as RothConversionConfigData[];
    saveRothConversionConfigs(configs);
    res.json(configs);
  } catch (error) {
    console.error('Error saving Roth conversion configs:', error);
    res.status(500).json({ error: 'Failed to save Roth conversion configs' });
  }
}));

// GET /api/retirement/projections — year-by-year retirement income projections
app.get('/api/retirement/projections', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  const result = await getRetirementProjections(req);
  res.json(result);
}));

// Paycheck compute route
app.post('/api/paycheck/compute', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const {
      profile,
      grossPay,
      billName,
      date,
      person,
      paychecksPerYear,
    } = req.body;

    // Validate required fields
    if (!profile || typeof grossPay !== 'number' || !billName || !date || typeof paychecksPerYear !== 'number') {
      return res.status(400).json({
        error: 'Missing or invalid required fields: profile, grossPay, billName, date, paychecksPerYear',
      });
    }

    // Load tax profile from JSON
    let taxProfile;
    try {
      const taxProfilePath = path.join(__dirname, '../data/taxProfile.json');
      const taxProfileData = JSON.parse(fs.readFileSync(taxProfilePath, 'utf-8'));
      taxProfile = taxProfileData;
    } catch {
      // Use defaults if file not found
      taxProfile = {
        filingStatus: 'mfj',
        state: 'NC',
        stateTaxRate: 0.0475,
        itemizationMode: 'standard',
      };
    }

    // Parse dates
    const paycheckDate = new Date(date);
    let ownerDOB: Date | null = null;
    if (person) {
      try {
        ownerDOB = getPersonBirthDate(person);
      } catch {
        ownerDOB = null;
      }
    }

    // Get SS wage base cap for the year (2024 is 168600, 2025 is 176100, default to 2025)
    const year = paycheckDate.getUTCFullYear();
    const ssWageBaseCap = year === 2024 ? 168600 : 176100;

    // Get bracket inflation rate (using 3% default)
    const bracketInflationRate = 0.03;

    // Compute net pay
    const result = computeNetPay({
      grossPay,
      profile: profile as PaycheckProfile,
      billName,
      date: paycheckDate,
      accountOwnerDOB: ownerDOB,
      paychecksPerYear,
      filingStatus: taxProfile.filingStatus || 'mfj',
      bracketInflationRate,
      ssWageBaseCap,
    });

    res.json({
      netPay: result.netPay,
      breakdown: result,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to compute net pay' });
  }
}));

// Cache clear endpoint (for development — forces re-reads of data files)
app.post('/api/cache/clear', verifyToken, (_req: Request, res: Response) => {
  clearDataCache();
  CacheManager.clearAll();
  clearRetirementCache();
  clearProjectionsCache();
  clearAcaCache();
  clearMedicareCache();
  clearContributionLimitCache();
  clearAllGraphCache();
  clearGlidePathCache();
  res.json({ success: true });
});

// Portfolio import routes
app.post('/api/portfolio/import/qfx', verifyToken, upload.single('file'), asyncHandler(importQfx));
app.post('/api/portfolio/import/csv', verifyToken, upload.single('file'), asyncHandler(importCsv));
app.get('/api/portfolio/ledger/:accountId', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getLedger(req, res);
}));
app.get('/api/portfolio/positions/:accountId', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getPositions(req, res);
}));

// Bank/CC Statement Import
app.post('/api/import/parse', verifyToken, upload.single('file'), asyncHandler(parseStatement));
app.get('/api/import/memory', verifyToken, asyncHandler(getImportMemory));
app.put('/api/import/memory', verifyToken, asyncHandler(updateImportMemory));
app.delete('/api/import/memory', verifyToken, asyncHandler(deleteImportMemory));

// Portfolio price routes (note: /current and /history/:symbol must come before /:symbol)
app.get('/api/prices/current', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getCurrentPricesEndpoint(req, res);
}));
app.get('/api/prices/history/:symbol', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getPriceHistoryEndpoint(req, res);
}));
app.get('/api/prices/:symbol', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getPriceEndpoint(req, res);
}));
app.post('/api/prices/refresh', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await refreshPricesEndpoint(req, res);
}));
app.post('/api/prices/override', verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
  await overridePriceEndpoint(req, res);
}));
app.delete('/api/prices/override', verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
  await deletePriceOverrideEndpoint(req, res);
}));
app.get('/api/prices/overrides/:symbol', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getPriceOverridesEndpoint(req, res);
}));

// Portfolio transaction CRUD
app.post('/api/portfolio/transactions/:accountId', verifyToken, express.json(), addTransaction);
app.get('/api/portfolio/transactions/:accountId', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await listTransactions(req, res);
}));
app.put('/api/portfolio/transactions/:accountId/:id', verifyToken, express.json(), editTransaction);
app.delete('/api/portfolio/transactions/:accountId/:id', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await deleteTransaction(req, res);
}));

// Portfolio reconciliation
app.post('/api/portfolio/reconcile/:accountId', verifyToken, express.json(), reconcileHoldings);

// Fund metadata routes
app.get('/api/portfolio/fund-metadata', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  await getFundMetadata(req, res);
}));
app.put('/api/portfolio/fund-metadata/:symbol', verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
  await updateFundMetadata(req, res);
}));

// Asset routes
app
  .route('/api/assets')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getAssets(req));
  }))
  .post(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    res.json(await addAsset(req));
  }));

app
  .route('/api/assets/:assetId')
  .put(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateAsset(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteAsset(req));
  }));

// ─── Life Insurance Routes ───

app
  .route('/api/insurance/life')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getLifeInsurancePolicies(req));
  }))
  .post(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    res.json(await createLifeInsurancePolicy(req));
  }));

app
  .route('/api/insurance/life/:policyId')
  .put(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    res.json(await updateLifeInsurancePolicy(req));
  }))
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteLifeInsurancePolicy(req));
  }));

// ─── Person Config Routes ───

app
  .route('/api/person-configs')
  .get(verifyToken, apiErrorHandler(getPersonConfigsHandler))
  .post(verifyToken, express.json(), apiErrorHandler(async (req: Request) => {
    const result = await createPersonConfig(req);
    clearDataCache();
    CacheManager.clearAll();
    return result;
  }))
  .put(verifyToken, express.json(), apiErrorHandler(async (req: Request) => {
    const result = await updatePersonConfigs(req);
    clearDataCache();
    CacheManager.clearAll();
    return result;
  }));

app
  .route('/api/person-configs/:name')
  .delete(verifyToken, apiErrorHandler(async (req: Request) => {
    const result = await deletePersonConfig(req);
    clearDataCache();
    CacheManager.clearAll();
    return result;
  }));

// ─── Rates Config Routes ───

app
  .route('/api/rates-config')
  .get(verifyToken, apiErrorHandler(getRatesConfigHandler))
  .put(verifyToken, express.json(), apiErrorHandler(updateRatesConfigHandler));

// ─── MC Mappings Routes ───

app
  .route('/api/mc-mappings')
  .get(verifyToken, apiErrorHandler(getMCMappingsHandler))
  .put(verifyToken, express.json(), apiErrorHandler(updateMCMappingsHandler));

// ─── LTC Insurance Routes ───

app
  .route('/api/insurance/ltc/config')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getLTCConfigs(req));
  }))
  .put(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    clearDataCache();
    CacheManager.clearAll();
    clearRetirementCache();
    clearProjectionsCache();
    clearAcaCache();
    clearMedicareCache();
    clearContributionLimitCache();
    clearAllGraphCache();
    clearGlidePathCache();
    res.json(await updateLTCConfigs(req));
  }));

app
  .route('/api/insurance/ltc/transitions')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getLTCTransitions(req));
  }))
  .put(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    clearDataCache();
    CacheManager.clearAll();
    clearRetirementCache();
    clearProjectionsCache();
    clearAcaCache();
    clearMedicareCache();
    clearContributionLimitCache();
    clearAllGraphCache();
    clearGlidePathCache();
    res.json(await updateLTCTransitions(req));
  }));

// ─── Inheritance Routes ───

app
  .route('/api/inheritance')
  .get(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await getInheritanceConfigs(req));
  }))
  .put(verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
    clearDataCache();
    CacheManager.clearAll();
    clearRetirementCache();
    clearProjectionsCache();
    clearAcaCache();
    clearMedicareCache();
    clearContributionLimitCache();
    clearAllGraphCache();
    clearGlidePathCache();
    res.json(await updateInheritanceConfigs(req));
  }));

// ─── Glide Path Routes ───

// Validation function for glide path waypoints
function validateWaypoints(waypoints: unknown): waypoints is Record<string, Record<string, number>> {
  if (!waypoints || typeof waypoints !== 'object') return false;
  for (const [yearStr, alloc] of Object.entries(waypoints as Record<string, unknown>)) {
    if (isNaN(Number(yearStr))) return false;
    if (!alloc || typeof alloc !== 'object') return false;
    for (const val of Object.values(alloc as Record<string, unknown>)) {
      if (typeof val !== 'number' || val < 0 || val > 1) return false;
    }
  }
  return true;
}

// Validation function for glide path names
function validatePathName(name: string): boolean {
  return /^[\w\s\-().]+$/.test(name);
}

// Global glide path
app.get('/api/glide-paths/global', verifyToken, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const data = load<Record<string, Record<string, number>>>('portfolioMakeupOverTime.json');
    res.json(data);
  } catch (error) {
    console.error('Error loading global glide path:', error);
    res.status(500).json({ error: 'Failed to load global glide path' });
  }
}));

app.put('/api/glide-paths/global', verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
  try {
    if (!validateWaypoints(req.body)) {
      return res.status(400).json({ error: 'Invalid waypoints format' });
    }
    const waypoints = req.body as Record<string, Record<string, number>>;
    save(waypoints, 'portfolioMakeupOverTime.json');
    clearGlidePathCache();
    CacheManager.clearAll();
    clearAllGraphCache();
    res.json(waypoints);
  } catch (error) {
    console.error('Error saving global glide path:', error);
    res.status(500).json({ error: 'Failed to save global glide path' });
  }
}));

// Custom glide paths
app.get('/api/glide-paths/custom', verifyToken, asyncHandler(async (_req: Request, res: Response) => {
  try {
    const data = load<Record<string, Record<string, Record<string, number>>>>('customGlidePaths.json');
    res.json(data);
  } catch (error) {
    console.error('Error loading custom glide paths:', error);
    res.status(500).json({ error: 'Failed to load custom glide paths' });
  }
}));

app.post('/api/glide-paths/custom', verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { name, waypoints } = req.body as { name: string; waypoints: Record<string, Record<string, number>> };
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!validatePathName(name)) {
      return res.status(400).json({ error: 'Invalid path name' });
    }
    if (name.toLowerCase() === 'global') {
      return res.status(400).json({ error: 'Name "global" is reserved' });
    }
    if (!validateWaypoints(waypoints)) {
      return res.status(400).json({ error: 'Invalid waypoints format' });
    }
    const data = load<Record<string, Record<string, Record<string, number>>>>('customGlidePaths.json');
    if (data[name]) {
      return res.status(409).json({ error: `Custom glide path "${name}" already exists` });
    }
    data[name] = waypoints;
    save(data, 'customGlidePaths.json');
    clearGlidePathCache();
    res.json({ name, waypoints });
  } catch (error) {
    console.error('Error creating custom glide path:', error);
    res.status(500).json({ error: 'Failed to create custom glide path' });
  }
}));

app.put('/api/glide-paths/custom/:name', verifyToken, express.json(), asyncHandler(async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { waypoints, newName } = req.body as { waypoints: Record<string, Record<string, number>>; newName?: string };
    if (!validateWaypoints(waypoints)) {
      return res.status(400).json({ error: 'Invalid waypoints format' });
    }
    const data = load<Record<string, Record<string, Record<string, number>>>>('customGlidePaths.json');
    if (!data[name]) {
      return res.status(404).json({ error: `Custom glide path "${name}" not found` });
    }
    // If renaming
    if (newName && newName !== name) {
      if (!validatePathName(newName)) {
        return res.status(400).json({ error: 'Invalid path name' });
      }
      if (newName.toLowerCase() === 'global') {
        return res.status(400).json({ error: 'Name "global" is reserved' });
      }
      if (data[newName]) {
        return res.status(409).json({ error: `Custom glide path "${newName}" already exists` });
      }
      // Update all account references
      const configs = loadPortfolioConfigs();
      for (const [accountId, config] of Object.entries(configs)) {
        if ((config as any).glidePath === name) {
          (config as any).glidePath = newName;
        }
      }
      savePortfolioConfigs(configs);
      delete data[name];
      data[newName] = waypoints;
    } else {
      data[name] = waypoints;
    }
    save(data, 'customGlidePaths.json');
    clearGlidePathCache();
    CacheManager.clearAll();
    clearAllGraphCache();
    res.json({ name: newName || name, waypoints });
  } catch (error) {
    console.error('Error updating custom glide path:', error);
    res.status(500).json({ error: 'Failed to update custom glide path' });
  }
}));

app.delete('/api/glide-paths/custom/:name', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    if (!validatePathName(name)) {
      return res.status(400).json({ error: 'Invalid path name' });
    }
    const data = load<Record<string, Record<string, Record<string, number>>>>('customGlidePaths.json');
    if (!data[name]) {
      return res.status(404).json({ error: `Custom glide path "${name}" not found` });
    }
    // Check if any accounts reference this path
    const configs = loadPortfolioConfigs();
    const referencingAccounts = Object.entries(configs)
      .filter(([_, config]) => (config as any).glidePath === name)
      .map(([id]) => id);
    if (referencingAccounts.length > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${referencingAccounts.length} account(s) still reference this glide path`,
        accounts: referencingAccounts,
      });
    }
    delete data[name];
    save(data, 'customGlidePaths.json');
    clearGlidePathCache();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting custom glide path:', error);
    res.status(500).json({ error: 'Failed to delete custom glide path' });
  }
}));

// Reference data endpoints
app.get('/api/reference/expected-returns', verifyToken, asyncHandler(getExpectedReturns));
app.put('/api/reference/expected-returns', verifyToken, asyncHandler(updateExpectedReturns));
app.get('/api/reference/capital-gains-rates', verifyToken, asyncHandler(getCapitalGainsRates));
app.put('/api/reference/capital-gains-rates', verifyToken, asyncHandler(updateCapitalGainsRates));
app.get('/api/tax/brackets/raw', verifyToken, asyncHandler(getTaxBracketsRaw));
app.put('/api/tax/brackets', verifyToken, asyncHandler(updateTaxBrackets));
app.get('/api/tax/withholding-tables/raw', verifyToken, asyncHandler(getWithholdingTablesRaw));
app.put('/api/tax/withholding-tables', verifyToken, asyncHandler(updateWithholdingTables));
app.get('/api/reference/life-insurance', verifyToken, asyncHandler(getLifeInsuranceReferenceData));
app.put('/api/reference/life-insurance', verifyToken, asyncHandler(updateLifeInsuranceReferenceData));
app.get('/api/reference/ltc-costs', verifyToken, asyncHandler(getLtcCosts));
app.put('/api/reference/ltc-costs', verifyToken, asyncHandler(updateLtcCosts));
app.get('/api/reference/bend-points', verifyToken, asyncHandler(getBendPoints));
app.put('/api/reference/bend-points', verifyToken, asyncHandler(updateBendPoints));
app.get('/api/reference/wage-index', verifyToken, asyncHandler(getWageIndex));
app.put('/api/reference/wage-index', verifyToken, asyncHandler(updateWageIndex));
app.get('/api/reference/irmaa', verifyToken, asyncHandler(getIrmaaBrackets));
app.put('/api/reference/irmaa', verifyToken, asyncHandler(updateIrmaaBrackets));
app.get('/api/reference/mortality', verifyToken, asyncHandler(getMortality));
app.put('/api/reference/mortality', verifyToken, asyncHandler(updateMortality));
app.get('/api/reference/market-returns', verifyToken, asyncHandler(getMarketReturns));
app.put('/api/reference/market-returns', verifyToken, asyncHandler(updateMarketReturns));

// Dev-only frontend logging endpoints
const FRONTEND_LOG_FILE = '/tmp/frontend.log';

if (process.env.DISABLE_AUTH === 'true') {
  app.post('/api/dev/log', (req: Request, res: Response) => {
    const { level, args, timestamp } = req.body;
    if (!Array.isArray(args)) {
      res.status(400).json({ error: 'args must be an array' });
      return;
    }
    const formattedArgs = args.map((arg: any) => JSON.stringify(arg)).join(' ');
    const logLine = `[${timestamp}] [${level}] ${formattedArgs}\n`;
    appendFile(FRONTEND_LOG_FILE, logLine).catch(() => {});
    res.json({ ok: true });
  });

  app.post('/api/dev/log/reset', (_req: Request, res: Response) => {
    fs.writeFileSync(FRONTEND_LOG_FILE, '');
    res.json({ ok: true });
  });
}

// Serve frontend for all non-API routes (SPA fallback)
app.get('*', (req: Request, res: Response) => {
  if (req.path.startsWith('/api/')) {
    res.status(404).json({ error: 'API endpoint not found' });
    return;
  }
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// Global error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err.stack || err.message || err);
  res.status(500).json({ error: 'Internal server error' });
});

// Export app for testing
export { app };

// Start server (only in non-test mode)
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
