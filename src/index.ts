import express, { Express, NextFunction, Request, Response } from 'express';
import bodyParser from 'body-parser';
import path from 'path';
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
import { getSharedSpending } from './api/accounts/consolidatedActivity/sharedSpending';
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
} from './api/monteCarlo/monteCarlo';
import { getHealthcareProgress } from './api/healthcare/progress';
import bcrypt from 'bcrypt';
import mysql from 'mysql';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { getMoneyMovementChart } from './api/moneyMovement/movement';
import { loadHealthcareConfigs, saveHealthcareConfigs } from './utils/io/healthcareConfigs';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

const app: Express = express();
const port = process.env.PORT || 5002;

// Middleware
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

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
  //next();
  //return;
  const token = req.headers.authorization;
  const userId = isTokenValid(token);
  if (!userId) {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }
  req.userId = userId;
  next();
};

// Account routes
app
  .route('/api/accounts')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getSimpleAccounts(req));
  })
  .put(verifyToken, async (req: Request, res: Response) => {
    res.json(await addAccount(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateAccounts(req));
  });

// Account graph routes
app.get('/api/accounts/:accountId/graph', verifyToken, async (req: Request, res: Response) => {
  res.json(await getAccountGraph(req));
});

app.get('/api/accounts/graph', verifyToken, async (req: Request, res: Response) => {
  res.json(await getGraphForAccounts(req));
});

app
  .route('/api/accounts/:accountId')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getAccount(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateAccount(req));
  })
  .delete(verifyToken, async (req: Request, res: Response) => {
    res.json(await removeAccount(req));
  });

// Account balance route
app.get('/api/accounts/:accountId/today_balance', verifyToken, async (req: Request, res: Response) => {
  res.json(await getTodayBalance(req));
});

// Activity routes
app
  .route('/api/accounts/:accountId/activity')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getAccountActivity(req));
  })
  .put(verifyToken, async (req: Request, res: Response) => {
    res.json(await addActivity(req));
  });

app
  .route('/api/accounts/:accountId/activity/:activityId')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getSpecificActivity(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateSpecificActivity(req));
  })
  .delete(verifyToken, async (req: Request, res: Response) => {
    res.json(await deleteSpecificActivity(req));
  });

app
  .route('/api/accounts/:accountId/activity/:activityId/change_account/:newAccountId')
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await changeAccountForActivity(req));
  });

// Bill routes
app
  .route('/api/accounts/:accountId/bills')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getAccountBills(req));
  })
  .put(verifyToken, async (req: Request, res: Response) => {
    res.json(await addBill(req));
  });

app
  .route('/api/accounts/:accountId/bills/:billId')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getSpecificBill(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateSpecificBill(req));
  })
  .delete(verifyToken, async (req: Request, res: Response) => {
    res.json(await deleteSpecificBill(req));
  });

app
  .route('/api/accounts/:accountId/bills/:billId/change_account/:newAccountId')
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await changeAccountForBill(req));
  });

// Calendar routes
app.get('/api/calendar/bills', verifyToken, async (req: Request, res: Response) => {
  res.json(await getCalendarBills(req));
});

// Interest routes
app
  .route('/api/accounts/:accountId/interests')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getAccountInterests(req));
  })
  .put(verifyToken, async (req: Request, res: Response) => {
    res.json(await addInterest(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateInterest(req));
  });

app
  .route('/api/accounts/:accountId/interests/:interestId')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getSpecificInterest(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateSpecificInterest(req));
  })
  .delete(verifyToken, async (req: Request, res: Response) => {
    res.json(await deleteSpecificInterest(req));
  });

// Consolidated activity routes
app.get('/api/accounts/:accountId/consolidated_activity', verifyToken, async (req: Request, res: Response) => {
  res.json(await getConsolidatedActivity(req));
});

app.get(
  '/api/accounts/:accountId/consolidated_activity/:activityId',
  verifyToken,
  async (req: Request, res: Response) => {
    res.json(await getSpecificConsolidatedActivity(req));
  },
);

// Category routes
app
  .route('/api/categories')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getCategories(req));
  })
  .put(verifyToken, async (req: Request, res: Response) => {
    res.json(await addCategory(req));
  })
  .delete(verifyToken, async (req: Request, res: Response) => {
    res.json(await deleteCategory(req));
  });

app.get('/api/categories/breakdown', verifyToken, async (req: Request, res: Response) => {
  res.json(await getCategoryBreakdown(req));
});

app.get('/api/categories/:section/transactions', verifyToken, async (req: Request, res: Response) => {
  res.json(await getCategorySectionTransactions(req));
});

app.get('/api/categories/:section/breakdown', verifyToken, async (req: Request, res: Response) => {
  res.json(await getCategorySectionBreakdown(req));
});

app.get('/api/categories/:section/:item/transactions', verifyToken, async (req: Request, res: Response) => {
  res.json(await getCategorySectionItemTransactions(req));
});

// Simulation routes
app
  .route('/api/simulations')
  .get(verifyToken, async (req: Request, res: Response) => {
    res.json(await getSimulations(req));
  })
  .post(verifyToken, async (req: Request, res: Response) => {
    res.json(await updateSimulations(req));
  });

app.get('/api/simulations/used_variables', verifyToken, async (req: Request, res: Response) => {
  res.json(await getUsedVariables(req));
});

// Name categories route
app.get('/api/names', verifyToken, async (req: Request, res: Response) => {
  res.json(await getNameCategories(req));
});

// Flow route
app.get('/api/flow', verifyToken, async (req: Request, res: Response) => {
  res.json(await getFlow(req));
});

// Monte Carlo route
app.get('/api/monte_carlo/start_simulation', verifyToken, async (req: Request, res: Response) => {
  res.json(await startSimulation(req));
});

// New Monte Carlo simulation routes
app.post('/api/monte_carlo/simulations', verifyToken, async (req: Request, res: Response) => {
  try {
    res.json(await startSimulation(req));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/monte_carlo/simulations', verifyToken, (req: Request, res: Response) => {
  try {
    res.json(getAllSimulations(req));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/monte_carlo/simulations/:id/status', verifyToken, (req: Request, res: Response) => {
  try {
    res.json(getSimulationStatus(req));
  } catch (error) {
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/api/monte_carlo/simulations/:id/graph', verifyToken, (req: Request, res: Response) => {
  try {
    res.json(getSimulationGraph(req));
  } catch (error) {
    const statusCode =
      error instanceof Error && (error.message.includes('not found') || error.message.includes('not yet completed'))
        ? 404
        : 400;
    res.status(statusCode).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

interface User {
  id: number;
  username: string;
  password: string;
}

app.post('/api/auth/token', async (req: Request, res: Response) => {
  const { username, password } = req.body;
  let connection;
  try {
    connection = mysql.createConnection({
      host: process.env.MYSQL_HOST,
      user: process.env.MYSQL_USERNAME,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
    });

    const query = promisify(connection.query).bind(connection);
    const results = (await query({
      sql: 'SELECT * FROM users WHERE username = ?',
      values: [username],
    })) as User[];
    const user = results[0];

    if (!(await bcrypt.compare(password, user.password))) {
      res.json({ token: 'INVALID' });
      return;
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || '', { expiresIn: '30d' });

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.json({ token: 'INVALID' });
  } finally {
    if (connection) {
      connection.end();
    }
  }
});

app.post('/api/auth/logout', verifyToken, (_req: Request, res: Response) => {
  res.json({ token: null });
});

app.post('/api/auth/register', async (_req: Request, res: Response) => {
  res.status(500).json({ error: 'This function is disabled' });
  return;
  // const { username, password } = req.body;
  // const hashedPassword = await bcrypt.hash(password, 10);
  // let connection;
  // try {
  //   connection = mysql.createConnection({
  //     host: process.env.MYSQL_HOST,
  //     user: process.env.MYSQL_USERNAME,
  //     password: process.env.MYSQL_PASSWORD,
  //     database: process.env.MYSQL_DATABASE,
  //   });

  //   connection.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
  //   res.json({ success: true });
  // } catch {
  //   res.status(500).json({ error: 'Failed to create user' });
  // } finally {
  //   if (connection) {
  //     connection.end();
  //   }
  // }
});

app.get('/api/auth/validate', (req: Request, res: Response) => {
  const token = req.headers.authorization;
  const userId = isTokenValid(token);
  if (!userId) {
    res.status(401).json({ message: 'Invalid token' });
    return;
  }
  res.json({ token: userId });
});

app.get('/api/moneyMovement', verifyToken, async (req: Request, res: Response) => {
  res.json(await getMoneyMovementChart(req));
});

app.get('/api/sharedSpending', async (req: Request, res: Response) => {
  console.log('Request:', req);
  res.send(await getSharedSpending(req));
});

// Healthcare config routes
app.get('/api/healthcare/configs', verifyToken, async (req: Request, res: Response) => {
  try {
    const configs = await loadHealthcareConfigs();
    res.json(configs);
  } catch (error) {
    console.error('Error loading healthcare configs:', error);
    res.status(500).json({ error: 'Failed to load healthcare configs' });
  }
});

app.post('/api/healthcare/configs', verifyToken, async (req: Request, res: Response) => {
  try {
    const configs = await loadHealthcareConfigs();
    const newConfig = { ...req.body, id: uuidv4() };
    configs.push(newConfig);
    await saveHealthcareConfigs(configs);
    res.json(newConfig);
  } catch (error) {
    console.error('Error creating healthcare config:', error);
    res.status(500).json({ error: 'Failed to create healthcare config' });
  }
});

app.put('/api/healthcare/configs/:id', verifyToken, async (req: Request, res: Response) => {
  try {
    const configs = await loadHealthcareConfigs();
    const index = configs.findIndex(c => c.id === req.params.id);
    if (index === -1) {
      return res.status(404).json({ error: 'Config not found' });
    }
    configs[index] = { ...req.body, id: req.params.id };
    await saveHealthcareConfigs(configs);
    res.json(configs[index]);
  } catch (error) {
    console.error('Error updating healthcare config:', error);
    res.status(500).json({ error: 'Failed to update healthcare config' });
  }
});

app.delete('/api/healthcare/configs/:id', verifyToken, async (req: Request, res: Response) => {
  try {
    const configs = await loadHealthcareConfigs();
    const filtered = configs.filter(c => c.id !== req.params.id);
    await saveHealthcareConfigs(filtered);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting healthcare config:', error);
    res.status(500).json({ error: 'Failed to delete healthcare config' });
  }
});

app.get('/api/healthcare/progress', verifyToken, async (req: Request, res: Response) => {
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
});

app.get('/api/healthcare/expenses', verifyToken, async (req: Request, res: Response) => {
  try {
    const simulation = req.query.simulation as string;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    if (!simulation) {
      return res.status(400).json({ error: 'Simulation parameter required' });
    }

    // TODO: Implement expenses calculation
    // For now, return empty array (will be implemented in backend work)
    res.json([]);
  } catch (error) {
    console.error('Error getting healthcare expenses:', error);
    res.status(500).json({ error: 'Failed to get healthcare expenses' });
  }
});

// Serve frontend for all non-API routes (SPA fallback)
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
