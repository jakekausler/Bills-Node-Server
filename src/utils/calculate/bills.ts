import { isSame } from '../date/date';
import { Account } from '../../data/account/account';
import { isBefore } from '../date/date';
import { formatDate } from '../date/date';
import { Bill } from '../../data/bill/bill';
import { isBeforeOrSame } from '../date/date';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import { nextDate } from './helpers';
import { load } from '../io/io';
import { Rates } from './types';

export function addBills(account: Account, bills: Bill[], endDate: Date, simulation: string, monteCarlo: boolean) {
  for (const bill of bills) {
    let currDate = bill.startDate;
    let { billIncreasedAmount, billNextIncreaseDate } = getBillIncreasedAmountAndNextIncreaseDate(
      bill,
      bill.amount,
      bill.startDate,
      true,
      monteCarlo,
    );

    if (bill.isTransfer && account.name !== bill.fro && account.name !== bill.to) {
      continue;
    }

    while (isBeforeOrSame(currDate, endDate) && (!bill.endDate || isBeforeOrSame(currDate, bill.endDate))) {
      // While we are below either the specified end date or the bill's end date

      // Check if we need to increase the bill's amount
      if (isBefore(billNextIncreaseDate, currDate)) {
        // We need to increase the bill's amount if we passed the next increase date
        ({ billIncreasedAmount, billNextIncreaseDate } = getBillIncreasedAmountAndNextIncreaseDate(
          bill,
          billIncreasedAmount,
          billNextIncreaseDate,
          false,
          monteCarlo,
        ));
      }

      // If this is a transfer, we need to show that we are moving money out of the account for the transferring side
      let amount = billIncreasedAmount;
      if (typeof amount === 'number' && account.name === bill.fro) {
        amount *= -1;
      }
      const activity = bill.toActivity(
        // Match transfer ids so they can be looked up
        bill.isTransfer ? bill.id + '-' + formatDate(currDate) : uuidv4(),
        simulation,
        amount,
        currDate,
      );
      account.consolidatedActivity.push(
        new ConsolidatedActivity(activity.serialize(), {
          billId: bill.id,
        }),
      );

      // Check if this is a first bill
      if (isSame(currDate, bill.startDate)) {
        account.consolidatedActivity[account.consolidatedActivity.length - 1].firstBill = true;
      }

      currDate = nextDate(currDate, bill.periods, bill.everyN);
      currDate = bill.checkAnnualDates(currDate);
    }
  }
}

function getBillIncreasedAmountAndNextIncreaseDate(
  bill: Bill,
  prevBillIncreasedAmount: number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}',
  prevBillNextIncreaseDate: Date,
  isFirst: boolean,
  monteCarlo: boolean,
) {
  let billNextIncreaseDate = prevBillNextIncreaseDate;
  if (bill.increaseByPeriods === 'year') {
    billNextIncreaseDate = dayjs(prevBillNextIncreaseDate).add(1, 'year').set('date', 1).set('month', 0).toDate();
  } else {
    billNextIncreaseDate = nextDate(prevBillNextIncreaseDate, bill.increaseByPeriods, 1);
  }
  const billIncreasedAmount =
    typeof prevBillIncreasedAmount === 'number' && !isFirst
      ? prevBillIncreasedAmount * (1 + getIncreaseBy(bill, dayjs(billNextIncreaseDate).year(), monteCarlo))
      : prevBillIncreasedAmount;
  return { billIncreasedAmount, billNextIncreaseDate };
}

function getIncreaseBy(bill: Bill, year: number, monteCarlo: boolean) {
  if (monteCarlo) {
    return getMonteCarloIncreaseBy(bill, year);
  }
  return bill.increaseBy;
}

let RATES: Rates | null = null;

let YEAR_RATES: {
  [year: number]: {
    [rate: string]: number;
  };
} | null = null;
export function loadRatesToYears(startYear: number, endYear: number) {
  if (!RATES) {
    RATES = load('historicRates.json');
  }
  YEAR_RATES = {};
  for (let year = startYear; year <= endYear; year++) {
    YEAR_RATES[year] = {
      '401K_LIMIT_INCREASE_RATE':
        (RATES?.['401kLimitIncrease'][Math.floor(Math.random() * RATES['401kLimitIncrease'].length)] ?? 0) / 100,
      INFLATION: (RATES?.inflation[Math.floor(Math.random() * RATES['inflation'].length)] ?? 0) / 100,
      RAISE_RATE: (RATES?.raise[Math.floor(Math.random() * RATES['raise'].length)] ?? 0) / 100,
      MORTGAGE_INCREASE_RATE: 0,
    };
  }
}

function getMonteCarloIncreaseBy(bill: Bill, year: number) {
  switch (bill.increaseByVariable) {
    // case 'INVESTMENT_RATE':
    //   return 0.05;
    case '401K_LIMIT_INCREASE_RATE':
      return YEAR_RATES?.[year]?.[bill.increaseByVariable] ?? 0;
    case 'INFLATION':
      return YEAR_RATES?.[year]?.[bill.increaseByVariable] ?? 0;
    case 'RAISE_RATE':
      return YEAR_RATES?.[year]?.[bill.increaseByVariable] ?? 0;
    // case 'HIGH_YIELD_SAVINGS_RATE':
    //   return 0.0425;
    // case 'LOW_YIELD_SAVINGS_RATE':
    //   return 0.01;
    case 'MORTGAGE_INCREASE_RATE':
      return YEAR_RATES?.[year]?.[bill.increaseByVariable] ?? 0;
    default:
      console.warn(`Unknown increase by variable for bill ${bill.name}: ${bill.increaseByVariable}`);
      return bill.increaseBy;
  }
}
