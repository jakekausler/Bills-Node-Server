import express, { Express, NextFunction, Request, Response } from 'express';
import bodyParser from 'body-parser';
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
import { monteCarlo } from './api/accounts/monteCarlo/monteCarlo';
import bcrypt from 'bcrypt';
import mysql from 'mysql';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { getMoneyMovementChart } from './api/moneyMovement/movement';
import { averageOverTime } from './api/averageOverTime';
import { getSymbolHistory, getSymbolQuote } from './api/stocks/stocks';
import {
  addInvestmentAccount,
  deleteInvestmentAccount,
  getInvestmentAccounts,
  updateInvestmentAccount,
} from './api/investment/investment';
import { getInvestmentAccount } from './api/investment/investment';
import {
  addInvestmentAccountActivity,
  deleteInvestmentAccountSpecificActivity,
  getInvestmentAccountActivity,
  getInvestmentAccountSpecificActivity,
  updateInvestmentAccountSpecificActivity,
} from './api/investment/activity/activity';
import {
  deleteInvestmentShare,
  getInvestmentShare,
  updateInvestmentShare,
  addInvestmentShare,
  getInvestmentShares,
} from './api/investment/shares/shares';
import { addFromCSV } from './api/investment/activity/addFromCSV';

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
app.use(
  express.text({
    limit: '50mb',
  }),
);
app.use(
  express.json({
    limit: '50mb',
  }),
);
app.use(bodyParser.urlencoded({ extended: true }));

interface DecodedToken {
  userId: number;
}

const verifyToken = (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || '') as DecodedToken;
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid token' });
  }
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
app.get('/api/monte_carlo', verifyToken, async (req: Request, res: Response) => {
  res.json(await monteCarlo(req));
});

// Average over time route
app.get('/api/average_over_time', verifyToken, async (req: Request, res: Response) => {
  res.json(await averageOverTime(req));
});

// Stocks routes
app.get('/api/stocks/:symbol/history', verifyToken, async (req: Request, res: Response) => {
  res.json(await getSymbolHistory(req));
});
app.get('/api/stocks/:symbol/quote', verifyToken, async (req: Request, res: Response) => {
  res.json(await getSymbolQuote(req));
});

// Investment accounts routes
app.get('/api/investment/accounts', verifyToken, async (req: Request, res: Response) => {
  res.json(await getInvestmentAccounts(req));
});
app.put('/api/investment/accounts', verifyToken, async (req: Request, res: Response) => {
  res.json(await addInvestmentAccount(req));
});
app.get('/api/investment/accounts/:accountId', verifyToken, async (req: Request, res: Response) => {
  res.json(await getInvestmentAccount(req));
});
app.post('/api/investment/accounts/:accountId', verifyToken, async (req: Request, res: Response) => {
  res.json(await updateInvestmentAccount(req));
});
app.delete('/api/investment/accounts/:accountId', verifyToken, async (req: Request, res: Response) => {
  res.json(await deleteInvestmentAccount(req));
});

// Investment activity routes
app.get('/api/investment/accounts/:accountId/activity', verifyToken, async (req: Request, res: Response) => {
  res.json(await getInvestmentAccountActivity(req));
});
app.put('/api/investment/accounts/:accountId/activity', verifyToken, async (req: Request, res: Response) => {
  res.json(await addInvestmentAccountActivity(req));
});
app.post('/api/investment/accounts/:accountId/activity/from_csv', verifyToken, async (req: Request, res: Response) => {
  res.json(await addFromCSV(req));
});
app.get(
  '/api/investment/accounts/:accountId/activity/:activityId',
  verifyToken,
  async (req: Request, res: Response) => {
    res.json(await getInvestmentAccountSpecificActivity(req));
  },
);
app.post(
  '/api/investment/accounts/:accountId/activity/:activityId',
  verifyToken,
  async (req: Request, res: Response) => {
    res.json(await updateInvestmentAccountSpecificActivity(req));
  },
);
app.delete(
  '/api/investment/accounts/:accountId/activity/:activityId',
  verifyToken,
  async (req: Request, res: Response) => {
    res.json(await deleteInvestmentAccountSpecificActivity(req));
  },
);

// Investment shares routes
app.get('/api/investment/:accountId/shares', verifyToken, async (req: Request, res: Response) => {
  res.json(await getInvestmentShares(req));
});
app.put('/api/investment/:accountId/shares', verifyToken, async (req: Request, res: Response) => {
  res.json(await addInvestmentShare(req));
});
app.get('/api/investment/:accountId/shares/:symbol', verifyToken, async (req: Request, res: Response) => {
  res.json(await getInvestmentShare(req));
});
app.post('/api/investment/:accountId/shares/:symbol', verifyToken, async (req: Request, res: Response) => {
  res.json(await updateInvestmentShare(req));
});
app.delete('/api/investment/:accountId/shares/:symbol', verifyToken, async (req: Request, res: Response) => {
  res.json(await deleteInvestmentShare(req));
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

app.get('/api/moneyMovement', verifyToken, async (req: Request, res: Response) => {
  res.json(await getMoneyMovementChart(req));
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
