import dayjs from 'dayjs';
import { Account } from '../../data/account/account';
import { InvestmentAccount, InvestmentActivity } from '../../data/investment/investment';
import { formatDate, isAfter, isSame } from '../date/date';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { v4 as uuidv4 } from 'uuid';

export function handleInvestment(
  account: Account,
  investmentAccounts: InvestmentAccount[],
  currDate: Date,
  balanceMap: Record<string, number>,
  idxMap: Record<string, number>,
  historicalPrices: Record<string, Record<string, number>>,
  stockAmounts: Record<string, Record<string, number>>,
  investmentActivityIdxMap: Record<string, number>,
) {
  const investmentAccount = investmentAccounts.find((investmentAccount) => investmentAccount.name === account.name);
  if (!investmentAccount) {
    return;
  }
  // TODO: If the balanceMap[account.id] is greater than the investmentAccount.minimumCashBalance,
  // then we need to create a buy activity for every ticker in the investmentAccount.targets,
  // including custom mutual fund amounts. This should be divided based on the percentage
  // of the target with the difference between the balanceMap[account.id] and the
  // investmentAccount.minimumCashBalance.
  if (isAfter(currDate, new Date())) {
    const excessCash = balanceMap[account.id] - investmentAccount.cashTarget;
    //console.log(`\nExcess cash: ${excessCash} for ${account.name}`);
    if (excessCash > 0) {
      investmentAccount.targets.forEach((target) => {
        const topRatio = target.nonCashPortfolioTarget;
        if (target.isCustomFund) {
          target.customMakeup.forEach((custom) => {
            const excessCashPerTicker = excessCash * topRatio * custom.makeup;
            const excessShares = excessCashPerTicker / historicalPrices[custom.symbol][formatDate(currDate)];
            //console.log(`Excess Cash for ${custom.symbol}: ${excessCashPerTicker}`);
            //console.log(
            //  `Historical Price for ${custom.symbol}: ${historicalPrices[custom.symbol][formatDate(currDate)]}`,
            //);
            //console.log(`Excess Shares for ${custom.symbol}: ${excessShares}`);
            const investmentActivity = new InvestmentActivity({
              date: formatDate(currDate),
              symbol: custom.symbol,
              shares: excessShares,
              newShares: 0,
              price: historicalPrices[custom.symbol][formatDate(currDate)],
              type: 'buy',
              usesCash: true,
              memo: 'cash',
            });
            investmentAccount.activity.splice(investmentActivityIdxMap[investmentAccount.id], 0, investmentActivity);
          });
        } else {
          const excessCashPerTicker = excessCash * topRatio;
          const excessShares = excessCashPerTicker / historicalPrices[target.symbol][formatDate(currDate)];
          //console.log(`Excess Cash for ${target.symbol}: ${excessCashPerTicker}`);
          //console.log(
          //  `Historical Price for ${target.symbol}: ${historicalPrices[target.symbol][formatDate(currDate)]}`,
          //);
          //console.log(`Excess Shares for ${target.symbol}: ${excessShares}`);
          const investmentActivity = new InvestmentActivity({
            date: formatDate(currDate),
            symbol: target.symbol,
            shares: excessShares,
            newShares: 0,
            price: historicalPrices[target.symbol][formatDate(currDate)],
            type: 'buy',
            usesCash: true,
            memo: 'cash',
          });
          investmentAccount.activity.splice(investmentActivityIdxMap[investmentAccount.id], 0, investmentActivity);
        }
      });
    }
  }
  while (
    investmentAccount.activity[investmentActivityIdxMap[investmentAccount.id]] &&
    isSame(investmentAccount.activity[investmentActivityIdxMap[investmentAccount.id]].date, currDate)
  ) {
    const investmentActivity = investmentAccount.activity[investmentActivityIdxMap[investmentAccount.id]];
    let shareChange = investmentActivity.shares;
    if (investmentActivity.type === 'sell') {
      shareChange *= -1;
    }
    stockAmounts[investmentAccount.id][investmentActivity.symbol] += shareChange;

    let accountActivity;
    try {
      accountActivity = new ConsolidatedActivity({
        id: investmentActivity.id,
        date: formatDate(investmentActivity.date),
        dateIsVariable: false,
        dateVariable: null,
        amount: investmentActivity.usesCash ? investmentActivity.price * shareChange * -1 : 0,
        amountIsVariable: false,
        amountVariable: null,
        name: `${investmentActivity.symbol} ${investmentActivity.type} ${investmentActivity.memo}`,
        category: 'investment.investment',
        flag: false,
        flagColor: null,
        isTransfer: false,
        from: null,
        to: null,
      });
    } catch (e) {
      console.log(investmentActivity);
      throw e;
    }
    accountActivity.stockAmounts = stockAmounts[investmentAccount.id];
    accountActivity.stockValues = Object.fromEntries(
      Object.entries(stockAmounts[investmentAccount.id]).map(([symbol, amount]) => [
        symbol,
        historicalPrices[symbol][formatDate(currDate)] * amount,
      ]),
    );
    accountActivity.investmentValue = Object.values(accountActivity.stockValues).reduce((a, b) => a + b, 0);
    accountActivity.investmentActivity = investmentActivity;
    account.consolidatedActivity.splice(idxMap[account.id], 0, accountActivity);
    investmentActivityIdxMap[investmentAccount.id]++;
  }
}

export function setFuturePrices(
  currDate: Date,
  historicalPrices: Record<string, Record<string, number>>,
  expectedGrowths: Record<string, number>,
) {
  Object.entries(historicalPrices).forEach(([symbol, prices]) => {
    if (prices[formatDate(currDate)]) {
      return;
    }
    const lastPrice = prices[formatDate(dayjs(currDate).subtract(1, 'day').toDate())];
    const expectedGrowth = expectedGrowths[symbol];
    const futurePrice = lastPrice * (1 + expectedGrowth);
    //console.log(`${symbol} ${formatDate(currDate)}: ${lastPrice} => ${futurePrice} (${expectedGrowth})`);
    prices[formatDate(currDate)] = futurePrice || 0;
  });
}
