import { AccountsAndTransfers } from '../../data/account/types';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { formatDate } from '../date/date';
import { UsedVariables } from './types';

export function loadUsedVariables(
  accountsAndTransfers: AccountsAndTransfers,
  socialSecurity: SocialSecurity[],
  pensions: Pension[],
) {
  const usedVariables: UsedVariables = {};
  for (const account of accountsAndTransfers.accounts) {
    for (const activity of account.activity) {
      if (activity.amountIsVariable && activity.amountVariable) {
        if (!usedVariables[activity.amountVariable]) {
          usedVariables[activity.amountVariable] = [];
        }
        usedVariables[activity.amountVariable].push({
          type: 'activity',
          account: account.name,
          name: activity.name,
          date: formatDate(activity.date),
        });
      }
      if (activity.dateIsVariable && activity.dateVariable) {
        if (!usedVariables[activity.dateVariable]) {
          usedVariables[activity.dateVariable] = [];
        }
        usedVariables[activity.dateVariable].push({
          type: 'activity',
          account: account.name,
          name: activity.name,
        });
      }
    }
    for (const bill of account.bills) {
      if (bill.amountIsVariable && bill.amountVariable) {
        if (!usedVariables[bill.amountVariable]) {
          usedVariables[bill.amountVariable] = [];
        }
        usedVariables[bill.amountVariable].push({
          type: 'bill',
          account: account.name,
          name: bill.name,
          date: formatDate(bill.startDate),
        });
      }
      if (bill.startDateIsVariable && bill.startDateVariable) {
        if (!usedVariables[bill.startDateVariable]) {
          usedVariables[bill.startDateVariable] = [];
        }
        usedVariables[bill.startDateVariable].push({
          type: 'bill',
          account: account.name,
          name: bill.name,
        });
      }
      if (bill.endDateIsVariable && bill.endDateVariable) {
        if (!usedVariables[bill.endDateVariable]) {
          usedVariables[bill.endDateVariable] = [];
        }
        usedVariables[bill.endDateVariable].push({
          type: 'bill',
          account: account.name,
          name: bill.name,
          date: formatDate(bill.startDate),
        });
      }
      if (bill.increaseByIsVariable && bill.increaseByVariable) {
        if (!usedVariables[bill.increaseByVariable]) {
          usedVariables[bill.increaseByVariable] = [];
        }
        usedVariables[bill.increaseByVariable].push({
          type: 'bill',
          account: account.name,
          name: bill.name,
          date: formatDate(bill.startDate),
        });
      }
    }
    for (const interest of account.interests) {
      if (interest.applicableDateIsVariable && interest.applicableDateVariable) {
        if (!usedVariables[interest.applicableDateVariable]) {
          usedVariables[interest.applicableDateVariable] = [];
        }
        usedVariables[interest.applicableDateVariable].push({
          type: 'interest',
          account: account.name,
          name: 'Interest',
        });
      }
      if (interest.aprIsVariable && interest.aprVariable) {
        if (!usedVariables[interest.aprVariable]) {
          usedVariables[interest.aprVariable] = [];
        }
        usedVariables[interest.aprVariable].push({
          type: 'interest',
          account: account.name,
          name: 'Interest',
          date: formatDate(interest.applicableDate),
        });
      }
    }
  }
  for (const transfer of accountsAndTransfers.transfers.activity) {
    if (transfer.amountIsVariable && transfer.amountVariable) {
      if (!usedVariables[transfer.amountVariable]) {
        usedVariables[transfer.amountVariable] = [];
      }
      usedVariables[transfer.amountVariable].push({
        type: 'transfer',
        from: transfer.fro ?? '',
        to: transfer.to ?? '',
        name: transfer.name,
        date: formatDate(transfer.date),
      });
    }
    if (transfer.dateIsVariable && transfer.dateVariable) {
      if (!usedVariables[transfer.dateVariable]) {
        usedVariables[transfer.dateVariable] = [];
      }
      usedVariables[transfer.dateVariable].push({
        type: 'transfer',
        from: transfer.fro ?? '',
        to: transfer.to ?? '',
        name: transfer.name,
      });
    }
  }
  for (const bill of accountsAndTransfers.transfers.bills) {
    if (bill.amountIsVariable && bill.amountVariable) {
      if (!usedVariables[bill.amountVariable]) {
        usedVariables[bill.amountVariable] = [];
      }
      usedVariables[bill.amountVariable].push({
        type: 'bill',
        name: bill.name,
        from: bill.fro ?? '',
        to: bill.to ?? '',
        date: formatDate(bill.startDate),
      });
    }
    if (bill.startDateIsVariable && bill.startDateVariable) {
      if (!usedVariables[bill.startDateVariable]) {
        usedVariables[bill.startDateVariable] = [];
      }
      usedVariables[bill.startDateVariable].push({
        type: 'bill',
        name: bill.name,
        from: bill.fro ?? '',
        to: bill.to ?? '',
      });
    }
    if (bill.endDateIsVariable && bill.endDateVariable) {
      if (!usedVariables[bill.endDateVariable]) {
        usedVariables[bill.endDateVariable] = [];
      }
      usedVariables[bill.endDateVariable].push({
        type: 'bill',
        name: bill.name,
        from: bill.fro ?? '',
        to: bill.to ?? '',
        date: formatDate(bill.startDate),
      });
    }
    if (bill.increaseByIsVariable && bill.increaseByVariable) {
      if (!usedVariables[bill.increaseByVariable]) {
        usedVariables[bill.increaseByVariable] = [];
      }
      usedVariables[bill.increaseByVariable].push({
        type: 'bill',
        name: bill.name,
        from: bill.fro ?? '',
        to: bill.to ?? '',
        date: formatDate(bill.startDate),
      });
    }
  }
  for (const s of socialSecurity) {
    if (!usedVariables[s.startDateVariable]) {
      usedVariables[s.startDateVariable] = [];
    }
    usedVariables[s.startDateVariable].push({
      type: 'socialSecurity',
      name: s.name,
      date: formatDate(s.startDate),
    });
    if (!usedVariables[s.birthDateVariable]) {
      usedVariables[s.birthDateVariable] = [];
    }
    usedVariables[s.birthDateVariable].push({
      type: 'socialSecurity',
      name: s.name,
    });
  }
  for (const p of pensions) {
    if (!usedVariables[p.startDateVariable]) {
      usedVariables[p.startDateVariable] = [];
    }
    usedVariables[p.startDateVariable].push({
      type: 'pension',
      name: p.name,
      date: formatDate(p.startDate),
    });
    if (!usedVariables[p.birthDateVariable]) {
      usedVariables[p.birthDateVariable] = [];
    }
    usedVariables[p.birthDateVariable].push({
      type: 'pension',
      name: p.name,
    });
    if (!usedVariables[p.workStartDateVariable]) {
      usedVariables[p.workStartDateVariable] = [];
    }
    usedVariables[p.workStartDateVariable].push({
      type: 'pension',
      name: p.name,
    });
  }
  return usedVariables;
}
