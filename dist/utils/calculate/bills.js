import { isSame } from '../date/date';
import { formatDate } from '../date/date';
import { isBeforeOrSame } from '../date/date';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { v4 as uuidv4 } from 'uuid';
import { nextDate } from './helpers';
import { load } from '../io/io';
import { endTiming, startTiming } from '../log';
dayjs.extend(utc);
export function addBills(account, bills, endDate, simulation, monteCarlo) {
    startTiming('addBills');
    for (const bill of bills) {
        let currDate = bill.startDate;
        let { billIncreasedAmount, billNextIncreaseDate } = getBillIncreasedAmountAndNextIncreaseDate(bill, bill.amount, bill.startDate, true, monteCarlo);
        if (bill.isTransfer && account.name !== bill.fro && account.name !== bill.to) {
            continue;
        }
        while (isBeforeOrSame(currDate, endDate) && (!bill.endDate || isBeforeOrSame(currDate, bill.endDate))) {
            // While we are below either the specified end date or the bill's end date
            // Check if we need to increase the bill's amount
            if (isBeforeOrSame(billNextIncreaseDate, currDate)) {
                // We need to increase the bill's amount if we passed the next increase date
                ({ billIncreasedAmount, billNextIncreaseDate } = getBillIncreasedAmountAndNextIncreaseDate(bill, billIncreasedAmount, billNextIncreaseDate, false, monteCarlo));
            }
            // If this is a transfer, we need to show that we are moving money out of the account for the transferring side
            let amount = billIncreasedAmount;
            if (typeof amount === 'number' && account.name === bill.fro) {
                amount *= -1;
            }
            const activity = bill.toActivity(
            // Match transfer ids so they can be looked up
            bill.isTransfer ? bill.id + '-' + formatDate(currDate) : uuidv4(), simulation, amount, currDate);
            account.consolidatedActivity.push(new ConsolidatedActivity(activity.serialize(), {
                billId: bill.id,
            }));
            // Check if this is a first bill
            if (isSame(currDate, bill.startDate)) {
                account.consolidatedActivity[account.consolidatedActivity.length - 1].firstBill = true;
            }
            currDate = nextDate(currDate, bill.periods, bill.everyN);
            currDate = bill.checkAnnualDates(currDate);
        }
    }
    endTiming('addBills');
}
function getBillIncreasedAmountAndNextIncreaseDate(bill, prevBillIncreasedAmount, prevBillNextIncreaseDate, isFirst, monteCarlo) {
    let billNextIncreaseDate = prevBillNextIncreaseDate;
    const { day, month } = bill.increaseByDate;
    // Get the target date in the current year
    const currentYearTarget = dayjs.utc(prevBillNextIncreaseDate).set('month', month).set('date', day);
    // If the target date in current year is after the previous date, use current year
    // Otherwise, add a year
    billNextIncreaseDate = (currentYearTarget.isAfter(dayjs.utc(prevBillNextIncreaseDate))
        ? currentYearTarget
        : currentYearTarget.add(1, 'year')).toDate();
    let billIncreasedAmount = typeof prevBillIncreasedAmount === 'number' && !isFirst
        ? prevBillIncreasedAmount * (1 + getIncreaseBy(bill, dayjs.utc(billNextIncreaseDate).year(), monteCarlo))
        : prevBillIncreasedAmount;
    if (typeof billIncreasedAmount === 'number' && bill.ceilingMultiple > 0) {
        billIncreasedAmount = Math.ceil(billIncreasedAmount / bill.ceilingMultiple) * bill.ceilingMultiple;
    }
    return { billIncreasedAmount, billNextIncreaseDate };
}
function getIncreaseBy(bill, year, monteCarlo) {
    if (monteCarlo) {
        return getMonteCarloIncreaseBy(bill, year);
    }
    return bill.increaseBy;
}
let RATES = null;
let YEAR_RATES = null;
export function loadRatesToYears(startYear, endYear) {
    if (!RATES) {
        RATES = load('historicRates.json');
        if (!RATES) {
            throw new Error('Failed to load rates');
        }
    }
    YEAR_RATES = {};
    for (let year = startYear; year <= endYear; year++) {
        YEAR_RATES[year] = {
            '401K_LIMIT_INCREASE_RATE': (RATES.limitIncrease401k[Math.floor(Math.random() * RATES.limitIncrease401k.length)] ?? 0) / 100,
            INFLATION: (RATES.inflation[Math.floor(Math.random() * RATES.inflation.length)] ?? 0) / 100,
            RAISE_RATE: (RATES.raise[Math.floor(Math.random() * RATES.raise.length)] ?? 0) / 100,
            MORTGAGE_INCREASE_RATE: 0,
        };
    }
    // const avg401KLimitIncreaseRate =
    //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates['401K_LIMIT_INCREASE_RATE'], 0) /
    //   Object.keys(YEAR_RATES).length;
    // console.log(
    //   `Average 401K limit increase rate across years ${startYear}-${endYear}: ${(avg401KLimitIncreaseRate * 100).toFixed(
    //     2,
    //   )}%`,
    // );
    // const avgInflation =
    //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates.INFLATION, 0) / Object.keys(YEAR_RATES).length;
    // console.log(`Average inflation across years ${startYear}-${endYear}: ${(avgInflation * 100).toFixed(2)}%`);
    // const avgRaiseRate =
    //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates.RAISE_RATE, 0) /
    //   Object.keys(YEAR_RATES).length;
    // console.log(`Average raise rate across years ${startYear}-${endYear}: ${(avgRaiseRate * 100).toFixed(2)}%`);
    // const avgMortgageIncreaseRate =
    //   Object.values(YEAR_RATES).reduce((sum, yearRates) => sum + yearRates.MORTGAGE_INCREASE_RATE, 0) /
    //   Object.keys(YEAR_RATES).length;
    // console.log(
    //   `Average mortgage increase rate across years ${startYear}-${endYear}: ${(avgMortgageIncreaseRate * 100).toFixed(
    //     2,
    //   )}%`,
    // );
}
function getMonteCarloIncreaseBy(bill, year) {
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
