import express, { Express, Request, Response } from 'express';
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

const app: Express = express();
const port = process.env.PORT || 5002;

// Middleware
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Account routes
app
  .route('/api/accounts')
  .get((req: Request, res: Response) => {
    res.json(getSimpleAccounts(req));
  })
  .put((req: Request, res: Response) => {
    res.json(addAccount(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateAccounts(req));
  });

// Account graph routes
app.get('/api/accounts/:accountId/graph', (req: Request, res: Response) => {
  res.json(getAccountGraph(req));
});

app.get('/api/accounts/graph', (req: Request, res: Response) => {
  res.json(getGraphForAccounts(req));
});

app
  .route('/api/accounts/:accountId')
  .get((req: Request, res: Response) => {
    res.json(getAccount(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateAccount(req));
  })
  .delete((req: Request, res: Response) => {
    res.json(removeAccount(req));
  });

// Account balance route
app.get('/api/accounts/:accountId/today_balance', (req: Request, res: Response) => {
  res.json(getTodayBalance(req));
});

// Activity routes
app
  .route('/api/accounts/:accountId/activity')
  .get((req: Request, res: Response) => {
    res.json(getAccountActivity(req));
  })
  .put((req: Request, res: Response) => {
    res.json(addActivity(req));
  });

app
  .route('/api/accounts/:accountId/activity/:activityId')
  .get((req: Request, res: Response) => {
    res.json(getSpecificActivity(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateSpecificActivity(req));
  })
  .delete((req: Request, res: Response) => {
    res.json(deleteSpecificActivity(req));
  });

app
  .route('/api/accounts/:accountId/activity/:activityId/change_account/:newAccountId')
  .post((req: Request, res: Response) => {
    res.json(changeAccountForActivity(req));
  });

// Bill routes
app
  .route('/api/accounts/:accountId/bills')
  .get((req: Request, res: Response) => {
    res.json(getAccountBills(req));
  })
  .put((req: Request, res: Response) => {
    res.json(addBill(req));
  });

app
  .route('/api/accounts/:accountId/bills/:billId')
  .get((req: Request, res: Response) => {
    res.json(getSpecificBill(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateSpecificBill(req));
  })
  .delete((req: Request, res: Response) => {
    res.json(deleteSpecificBill(req));
  });

app.route('/api/accounts/:accountId/bills/:billId/change_account/:newAccountId').post((req: Request, res: Response) => {
  res.json(changeAccountForBill(req));
});

// Calendar routes
app.get('/api/calendar/bills', (req: Request, res: Response) => {
  res.json(getCalendarBills(req));
});

// Interest routes
app
  .route('/api/accounts/:accountId/interests')
  .get((req: Request, res: Response) => {
    res.json(getAccountInterests(req));
  })
  .put((req: Request, res: Response) => {
    res.json(addInterest(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateInterest(req));
  });

app
  .route('/api/accounts/:accountId/interests/:interestId')
  .get((req: Request, res: Response) => {
    res.json(getSpecificInterest(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateSpecificInterest(req));
  })
  .delete((req: Request, res: Response) => {
    res.json(deleteSpecificInterest(req));
  });

// Consolidated activity routes
app.get('/api/accounts/:accountId/consolidated_activity', (req: Request, res: Response) => {
  res.json(getConsolidatedActivity(req));
});

app.get('/api/accounts/:accountId/consolidated_activity/:activityId', (req: Request, res: Response) => {
  res.json(getSpecificConsolidatedActivity(req));
});

// Category routes
app
  .route('/api/categories')
  .get((req: Request, res: Response) => {
    res.json(getCategories(req));
  })
  .put((req: Request, res: Response) => {
    res.json(addCategory(req));
  })
  .delete((req: Request, res: Response) => {
    res.json(deleteCategory(req));
  });

app.get('/api/categories/breakdown', (req: Request, res: Response) => {
  res.json(getCategoryBreakdown(req));
});

app.get('/api/categories/:section/transactions', (req: Request, res: Response) => {
  res.json(getCategorySectionTransactions(req));
});

app.get('/api/categories/:section/breakdown', (req: Request, res: Response) => {
  res.json(getCategorySectionBreakdown(req));
});

app.get('/api/categories/:section/:item/transactions', (req: Request, res: Response) => {
  res.json(getCategorySectionItemTransactions(req));
});

// Simulation routes
app
  .route('/api/simulations')
  .get((req: Request, res: Response) => {
    res.json(getSimulations(req));
  })
  .post((req: Request, res: Response) => {
    res.json(updateSimulations(req));
  });

app.get('/api/simulations/used_variables', (req: Request, res: Response) => {
  res.json(getUsedVariables(req));
});

// Name categories route
app.get('/api/names', (req: Request, res: Response) => {
  res.json(getNameCategories(req));
});

// Flow route
app.get('/api/flow', (req: Request, res: Response) => {
  res.json(getFlow(req));
});

// Monte Carlo route
app.get('/api/monte_carlo', (req: Request, res: Response) => {
  res.json(monteCarlo(req));
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
