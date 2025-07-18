import express from 'express';
import bodyParser from 'body-parser';
import { getSimpleAccounts, addAccount, updateAccounts } from './api/accounts/accounts';
import { getAccount, updateAccount, removeAccount } from './api/accounts/account';
import { getGraphForAccounts } from './api/accounts/graph';
import { getTodayBalance } from './api/accounts/todayBalance';
import { getAccountGraph } from './api/accounts/graph';
import { getAccountActivity, addActivity } from './api/accounts/activity/activity';
import { getSpecificActivity, updateSpecificActivity, deleteSpecificActivity, changeAccountForActivity, } from './api/accounts/activity/specificActivity';
import { getAccountBills, addBill } from './api/accounts/bills/bills';
import { getSpecificBill, updateSpecificBill, deleteSpecificBill, changeAccountForBill, } from './api/accounts/bills/bill';
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
import { monteCarlo } from './api/accounts/monteCarlo/monteCarlo';
import bcrypt from 'bcrypt';
import mysql from 'mysql';
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { getMoneyMovementChart } from './api/moneyMovement/movement';
const app = express();
const port = process.env.PORT || 5002;
// Middleware
app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
const isTokenValid = (token) => {
    if (!token) {
        return false;
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || '');
        return decoded.userId;
    }
    catch {
        return false;
    }
};
const verifyToken = (req, res, next) => {
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
    .get(verifyToken, (req, res) => {
    res.json(getSimpleAccounts(req));
})
    .put(verifyToken, (req, res) => {
    res.json(addAccount(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateAccounts(req));
});
// Account graph routes
app.get('/api/accounts/:accountId/graph', verifyToken, (req, res) => {
    res.json(getAccountGraph(req));
});
app.get('/api/accounts/graph', verifyToken, (req, res) => {
    res.json(getGraphForAccounts(req));
});
app
    .route('/api/accounts/:accountId')
    .get(verifyToken, (req, res) => {
    res.json(getAccount(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateAccount(req));
})
    .delete(verifyToken, (req, res) => {
    res.json(removeAccount(req));
});
// Account balance route
app.get('/api/accounts/:accountId/today_balance', verifyToken, (req, res) => {
    res.json(getTodayBalance(req));
});
// Activity routes
app
    .route('/api/accounts/:accountId/activity')
    .get(verifyToken, (req, res) => {
    res.json(getAccountActivity(req));
})
    .put(verifyToken, (req, res) => {
    res.json(addActivity(req));
});
app
    .route('/api/accounts/:accountId/activity/:activityId')
    .get(verifyToken, (req, res) => {
    res.json(getSpecificActivity(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateSpecificActivity(req));
})
    .delete(verifyToken, (req, res) => {
    res.json(deleteSpecificActivity(req));
});
app
    .route('/api/accounts/:accountId/activity/:activityId/change_account/:newAccountId')
    .post(verifyToken, (req, res) => {
    res.json(changeAccountForActivity(req));
});
// Bill routes
app
    .route('/api/accounts/:accountId/bills')
    .get(verifyToken, (req, res) => {
    res.json(getAccountBills(req));
})
    .put(verifyToken, (req, res) => {
    res.json(addBill(req));
});
app
    .route('/api/accounts/:accountId/bills/:billId')
    .get(verifyToken, (req, res) => {
    res.json(getSpecificBill(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateSpecificBill(req));
})
    .delete(verifyToken, (req, res) => {
    res.json(deleteSpecificBill(req));
});
app
    .route('/api/accounts/:accountId/bills/:billId/change_account/:newAccountId')
    .post(verifyToken, (req, res) => {
    res.json(changeAccountForBill(req));
});
// Calendar routes
app.get('/api/calendar/bills', verifyToken, (req, res) => {
    res.json(getCalendarBills(req));
});
// Interest routes
app
    .route('/api/accounts/:accountId/interests')
    .get(verifyToken, (req, res) => {
    res.json(getAccountInterests(req));
})
    .put(verifyToken, (req, res) => {
    res.json(addInterest(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateInterest(req));
});
app
    .route('/api/accounts/:accountId/interests/:interestId')
    .get(verifyToken, (req, res) => {
    res.json(getSpecificInterest(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateSpecificInterest(req));
})
    .delete(verifyToken, (req, res) => {
    res.json(deleteSpecificInterest(req));
});
// Consolidated activity routes
app.get('/api/accounts/:accountId/consolidated_activity', verifyToken, (req, res) => {
    res.json(getConsolidatedActivity(req));
});
app.get('/api/accounts/:accountId/consolidated_activity/:activityId', verifyToken, (req, res) => {
    res.json(getSpecificConsolidatedActivity(req));
});
// Category routes
app
    .route('/api/categories')
    .get(verifyToken, (req, res) => {
    res.json(getCategories(req));
})
    .put(verifyToken, (req, res) => {
    res.json(addCategory(req));
})
    .delete(verifyToken, (req, res) => {
    res.json(deleteCategory(req));
});
app.get('/api/categories/breakdown', verifyToken, (req, res) => {
    res.json(getCategoryBreakdown(req));
});
app.get('/api/categories/:section/transactions', verifyToken, (req, res) => {
    res.json(getCategorySectionTransactions(req));
});
app.get('/api/categories/:section/breakdown', verifyToken, (req, res) => {
    res.json(getCategorySectionBreakdown(req));
});
app.get('/api/categories/:section/:item/transactions', verifyToken, (req, res) => {
    res.json(getCategorySectionItemTransactions(req));
});
// Simulation routes
app
    .route('/api/simulations')
    .get(verifyToken, (req, res) => {
    res.json(getSimulations(req));
})
    .post(verifyToken, (req, res) => {
    res.json(updateSimulations(req));
});
app.get('/api/simulations/used_variables', verifyToken, (req, res) => {
    res.json(getUsedVariables(req));
});
// Name categories route
app.get('/api/names', verifyToken, (req, res) => {
    res.json(getNameCategories(req));
});
// Flow route
app.get('/api/flow', verifyToken, (req, res) => {
    res.json(getFlow(req));
});
// Monte Carlo route
app.get('/api/monte_carlo', verifyToken, (req, res) => {
    res.json(monteCarlo(req));
});
app.post('/api/auth/token', async (req, res) => {
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
        }));
        const user = results[0];
        if (!(await bcrypt.compare(password, user.password))) {
            res.json({ token: 'INVALID' });
            return;
        }
        const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || '', { expiresIn: '30d' });
        res.json({ token });
    }
    catch (err) {
        console.error(err);
        res.json({ token: 'INVALID' });
    }
    finally {
        if (connection) {
            connection.end();
        }
    }
});
app.post('/api/auth/logout', verifyToken, (_req, res) => {
    res.json({ token: null });
});
app.post('/api/auth/register', async (_req, res) => {
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
app.get('/api/auth/validate', (req, res) => {
    const token = req.headers.authorization;
    const userId = isTokenValid(token);
    if (!userId) {
        res.status(401).json({ message: 'Invalid token' });
        return;
    }
    res.json({ token: userId });
});
app.get('/api/moneyMovement', verifyToken, (req, res) => {
    res.json(getMoneyMovementChart(req));
});
app.get('/api/sharedSpending', (req, res) => {
    console.log('Request:', req);
    res.send(getSharedSpending(req));
});
// Start server
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
