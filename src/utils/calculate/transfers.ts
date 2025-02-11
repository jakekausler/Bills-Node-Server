import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import { Account } from '../../data/account/account';
import { Transfers } from '../../data/account/types';
import { addBills } from './bills';
import { getById, getByIdWithIdx } from '../array/array';
import { endTiming } from '../log';
import { startTiming } from '../log';

export function addTransfers(
  account: Account,
  endDate: Date,
  simulation: string,
  transfers: Transfers,
  monteCarlo: boolean,
) {
  startTiming('addTransfers');
  for (const activity of transfers.activity) {
    if (account.name === activity.fro) {
      account.consolidatedActivity.push(
        new ConsolidatedActivity(activity.serialize(), {
          reverseAmount: true,
        }),
      );
    } else if (account.name === activity.to) {
      account.consolidatedActivity.push(new ConsolidatedActivity(activity.serialize()));
    }
  }
  addBills(account, transfers.bills, endDate, simulation, monteCarlo);
  endTiming('addTransfers');
}

export function dealWithOtherTransfers(
  account: Account,
  accounts: Account[],
  idxMap: Record<string, number>,
  balanceMap: Record<string, number>,
) {
  const activity = account.consolidatedActivity[idxMap[account.id]];
  if (
    activity.isTransfer &&
    activity.billId && // Only handle transfers with billId
    activity.amountVariable !== '{HALF}' &&
    activity.amountVariable !== '{FULL}' &&
    activity.fro === account.name // Only process transfer from the "from" account
  ) {
    // Get the account on the receiving end of the transfer
    const otherAccountName = activity.to;
    const otherAccount = accounts.find((acc) => acc.name === otherAccountName);
    if (!otherAccount) {
      throw new Error(`Account ${otherAccountName} not found`);
    }

    const otherActivity = getById<ConsolidatedActivity>(otherAccount.consolidatedActivity, activity.id);
    if (!otherActivity) {
      throw new Error(`Activity ${activity.id} not found on other side`);
    }

    let adjustedAmount = activity.amount as number;

    // Handle "to" account limits for Loan/Credit accounts
    if (otherAccount.type === 'Loan' || otherAccount.type === 'Credit') {
      const maxTransfer = Math.abs(balanceMap[otherAccount.id]);
      adjustedAmount = Math.min(Math.abs(adjustedAmount), maxTransfer);
      adjustedAmount *= -1; // Maintain negative value for receiving Loan/Credit account
    }

    // Handle "from" account limits for non-Loan/Credit accounts
    // If the "to" account is savings or investment, we need to limit the transfer to the available balance
    if (
      account.type !== 'Loan' &&
      account.type !== 'Credit' &&
      (otherAccount.type === 'Savings' || otherAccount.type === 'Investment')
    ) {
      const availableBalance = balanceMap[account.id];
      if (Math.abs(adjustedAmount) > availableBalance) {
        adjustedAmount = Math.min(Math.abs(adjustedAmount), availableBalance > 0 ? -availableBalance : 0);
      }
    }

    // Update both sides of the transfer
    activity.amount = adjustedAmount;
    otherActivity.amount = -adjustedAmount;
  }
}

// Return false if the activity was removed
export function dealWithSpecialFractions(
  account: Account,
  accounts: Account[],
  idxMap: Record<string, number>,
  balanceMap: Record<string, number>,
) {
  // If the activity is a special fractional transfer, we need to handle that
  // This will transfer in the following ways:
  // - If the "to" account is a Loan or Credit account, the transfer will amount to half or all of the "to" account's balance
  // - If the "to" account is a non-Loan/Credit account, the transfer will amount to half or all of the "from" account's balance
  if (
    account.consolidatedActivity[idxMap[account.id]].amount === '{HALF}' ||
    account.consolidatedActivity[idxMap[account.id]].amount === '{FULL}'
  ) {
    // Get the account on the recieving end of the transfer
    const otherAccountName = account.consolidatedActivity[idxMap[account.id]].to;
    let otherAccount = null;
    for (const account of accounts) {
      if (account.name === otherAccountName) {
        otherAccount = account;
        break;
      }
    }
    if (!otherAccount) {
      throw new Error(`Account ${otherAccountName} not found`);
    }
    const balanceToUse =
      otherAccount.type === 'Loan' || otherAccount.type === 'Credit'
        ? balanceMap[otherAccount.id]
        : -balanceMap[account.id];
    // Find the corresponding activity and its index in the other account's consolidated activity array
    const { item: otherActivity, idx: otherActivityIdx } = getByIdWithIdx<ConsolidatedActivity>(
      otherAccount.consolidatedActivity,
      account.consolidatedActivity[idxMap[account.id]].id,
    );
    if (!otherActivity) {
      throw new Error(`Activity ${account.consolidatedActivity[idxMap[account.id]].id} not found on other side`);
    }
    let amount = 0;
    if (account.consolidatedActivity[idxMap[account.id]].amount === '{HALF}') {
      // If the amount is half, we need to split the other account's balance in half and update the activities on both sides. Because the amount will be overrided from "{HALF}" to the actual amount, whichever side is processed first will update both sides
      // Calculate the half the other account's balance and round to 2 decimal places
      amount = Math.round((balanceToUse / 2) * 100) / 100;
    } else if (account.consolidatedActivity[idxMap[account.id]].amount === '{FULL}') {
      // If the amount is full, we need to add the full balance of the recieving account as an activity on both sides. Because the amount will be overrided from "{FULL}" to the actual amount, whichever side is processed first will update both sides
      amount = balanceToUse;
    }
    if (amount === 0) {
      // If the amount is 0, we don't want to show it. Remove the activity from both sides
      account.consolidatedActivity.splice(idxMap[account.id], 1);
      otherAccount.consolidatedActivity.splice(otherActivityIdx, 1);
      return true;
    } else {
      // Update the amount of the activity on the other side
      otherAccount.consolidatedActivity[otherActivityIdx].amount = -amount;
      // Set the amount of the activity on this side
      account.consolidatedActivity[idxMap[account.id]].amount = amount;
    }
  }
  return false;
}
