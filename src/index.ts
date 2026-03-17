import express, { Express, NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { appendFile } from 'fs/promises';
import { getSimpleAccounts, addAccount, updateAccounts } from './api/accounts/accounts';
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
import { getCategories, addCategory, deleteCategory } from './api/categories/categories';
import { getCategoryBreakdown } from './api/categories/breakdown';
import { getCategorySectionItemTransactions } from './api/categories/section/item/transactions';
import { getSimulations, updateSimulations } from './api/simulations/simulations';
import { getUsedVariables } from './api/simulations/usedVariables';
import { getNameCategories } from './api/names/names';
import { getFlow } from './api/flow/flow';
import { getCategorySectionTransactions } from './api/categories/section/transactions';
import { getCategorySectionBreakdown } from './api/categories/section/breakdown';
import {
  startSimulation,
  getSimulationStatus,
  getAllSimulations,
  getSimulationGraph,
  deleteSimulation,
} from './api/monteCarlo/monteCarlo';
import { getHealthcareProgress } from './api/healthcare/progress';
import { getHealthcareExpenses } from './api/healthcare/expenses';
import { getHealthcareProgressHistory } from './api/healthcare/progressHistory';
import bcrypt from 'bcrypt';
import mysql from 'mysql';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import rateLimit from 'express-rate-limit';
import { getMoneyMovementChart } from './api/moneyMovement/movement';
import { loadHealthcareConfigs, saveHealthcareConfigs } from './utils/io/healthcareConfigs';
import { loadAllHealthcareConfigs } from './utils/io/virtualHealthcarePlans';
import { v4 as uuidv4 } from 'uuid';
import { clearDataCache } from './utils/io/dataCache';
import { CacheManager } from './utils/calculate-v3/cache';
import { clearRetirementCache } from './utils/calculate-v3/retirement-manager';
import { clearAcaCache } from './utils/calculate-v3/aca-manager';
import { clearMedicareCache } from './utils/calculate-v3/medicare-manager';
import { clearContributionLimitCache } from './utils/calculate-v3/contribution-limit-manager';
import {
  getSpendingTrackerCategories,
  getSpendingTrackerCategory,
  createSpendingTrackerCategory,
  updateSpendingTrackerCategory,
  deleteSpendingTrackerCategory,
  getSpendingTrackerChartData,
  ApiError,
} from './api/spendingTracker/spendingTracker';

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

const apiErrorHandler = (fn: (req: Request) => Promise<any>) =>
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
  .delete(verifyToken, asyncHandler(async (req: Request, res: Response) => {
    res.json(await deleteCategory(req));
  }));

app.get('/api/categories/breakdown', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCategoryBreakdown(req));
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

// Name categories route
app.get('/api/names', verifyToken, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getNameCategories(req));
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

    const missingFields = requiredFields.filter(field => req.body[field] === undefined || req.body[field] === null || req.body[field] === '');

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(', ')}`
      });
    }

    const configs = await loadHealthcareConfigs();
    const {
      name,
      coveredPersons,
      startDate,
      endDate,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId,
      hsaReimbursementEnabled,
      resetMonth,
      resetDay,
    } = req.body;
    const newConfig = {
      id: uuidv4(),
      name,
      coveredPersons,
      startDate,
      endDate,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId,
      hsaReimbursementEnabled,
      resetMonth,
      resetDay,
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
      startDate,
      endDate,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId,
      hsaReimbursementEnabled,
      resetMonth,
      resetDay,
    } = req.body;
    configs[index] = {
      id: req.params.id,
      name,
      coveredPersons,
      startDate,
      endDate,
      individualDeductible,
      individualOutOfPocketMax,
      familyDeductible,
      familyOutOfPocketMax,
      hsaAccountId,
      hsaReimbursementEnabled,
      resetMonth,
      resetDay,
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

// Cache clear endpoint (for development — forces re-reads of data files)
app.post('/api/cache/clear', verifyToken, (_req: Request, res: Response) => {
  clearDataCache();
  CacheManager.clearAll();
  clearRetirementCache();
  clearAcaCache();
  clearMedicareCache();
  clearContributionLimitCache();
  res.json({ success: true });
});

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
