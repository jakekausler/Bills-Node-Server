import { Request, Response } from 'express';
import { getAccountsAndTransfers, saveData } from '../../utils/io/accountsAndTransfers';
import { loadImportMemory, saveImportMemory } from '../../utils/import/importMemory';
import { Activity } from '../../data/activity/activity';
import { insertBill } from '../../data/bill/bill';
import { insertInterest } from '../../data/interest/interest';
import { parseDate } from '../../utils/date/date';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { ActivityData } from '../../data/activity/types';
import type { AccountsAndTransfers } from '../../data/account/types';
import type { ImportMemory } from './types';

dayjs.extend(utc);

interface ExecuteDecision {
  type: 'match-activity' | 'update-activity' | 'enter-bill' | 'enter-interest' | 'new-activity' | 'skip' | 'delete-activity';
  activityId?: string;
  billId?: string;
  interestId?: string;
  activityData?: ActivityData;
  statementName?: string;
}

interface ExecuteSoftSkip {
  type: 'bill' | 'interest';
  billId?: string;
  interestId?: string;
}

interface ExecuteRequest {
  accountId: string;
  headerHash: string;
  decisions: ExecuteDecision[];
  softSkips: ExecuteSoftSkip[];
  memoryUpdates: {
    transactionMappings?: Record<string, Array<{ name: string; category: string; spendingCategory: string; isTransfer: boolean; from: string; to: string }>>;
    transferOverrides?: Record<string, Record<string, { from: string; to: string }>>;
  };
  fileHash: string;
}

interface ExecuteResponse {
  activitiesCreated: number;
  activitiesUpdated: number;
  billsEntered: number;
  interestsEntered: number;
  activitiesMatched: number;
  skipped: number;
  billsSkipped: number;
  interestsSkipped: number;
  activitiesDeleted: number;
}

/**
 * Execute bulk import decisions atomically
 * Processes all decisions in chronological order with a single save at the end
 */
export async function executeImport(req: Request, res: Response): Promise<void> {
  try {
    const body = req.body as ExecuteRequest;
    const simulation = (req.query.simulation as string) || 'Default';

    // Validate required fields
    if (!body.accountId || !body.decisions) {
      res.status(400).json({ error: 'Missing required fields: accountId, decisions' });
      return;
    }

    // Load raw data (no calculations needed)
    const data = getAccountsAndTransfers(simulation);

    // Find the account
    const account = data.accounts.find((a) => a.id === body.accountId);
    if (!account) {
      res.status(400).json({ error: `Account not found: ${body.accountId}` });
      return;
    }

    // Sort decisions by date ascending (chronological order)
    const sortedDecisions = [...body.decisions].sort((a, b) => {
      if (!a.activityData?.date || !b.activityData?.date) return 0;
      return dayjs.utc(a.activityData.date).isBefore(dayjs.utc(b.activityData.date)) ? -1 : 1;
    });

    // Initialize counters
    const response: ExecuteResponse = {
      activitiesCreated: 0,
      activitiesUpdated: 0,
      billsEntered: 0,
      interestsEntered: 0,
      activitiesMatched: 0,
      skipped: 0,
      billsSkipped: 0,
      interestsSkipped: 0,
      activitiesDeleted: 0,
    };

    // Process each decision
    for (const decision of sortedDecisions) {
      switch (decision.type) {
        case 'match-activity':
          response.activitiesMatched++;
          break;

        case 'update-activity': {
          if (!decision.activityId || !decision.activityData) {
            throw new Error(`update-activity decision missing activityId or activityData`);
          }

          // Find activity in transfers first, then account
          let activity = data.transfers.activity.find((a) => a.id === decision.activityId);
          let foundInTransfers = !!activity;
          let activityIdx = -1;

          if (!activity) {
            activityIdx = account.activity.findIndex((a) => a.id === decision.activityId);
            if (activityIdx === -1) {
              // Activity not found — check if this is a projected bill/interest occurrence
              // Composite IDs look like: "billId-dateString" e.g. "d773fe9f-...-Sat Mar 14 2026..."
              let handledAsProjected = false;

              // Check account bills and transfer bills
              let bill = account.bills.find(b => decision.activityId!.startsWith(b.id));
              let isTransferBill = false;
              if (!bill) {
                bill = data.transfers.bills.find(b => decision.activityId!.startsWith(b.id));
                isTransferBill = !!bill;
              }

              if (bill && decision.activityData) {
                // Treat as enter-bill: override activityData fields from bill definition
                decision.activityData.name = bill.name;
                decision.activityData.category = bill.category;
                decision.activityData.isTransfer = bill.isTransfer;
                decision.activityData.from = bill.fro;
                decision.activityData.to = bill.to;
                if (decision.activityData.flag === undefined) {
                  decision.activityData.flag = bill.flag;
                }
                if (decision.activityData.flagColor === undefined) {
                  decision.activityData.flagColor = bill.flagColor;
                }
                decision.activityData.isHealthcare = bill.isHealthcare;
                decision.activityData.healthcarePerson = bill.healthcarePerson;
                decision.activityData.copayAmount = bill.copayAmount;
                decision.activityData.coinsurancePercent = bill.coinsurancePercent;
                decision.activityData.countsTowardDeductible = bill.countsTowardDeductible;
                decision.activityData.countsTowardOutOfPocket = bill.countsTowardOutOfPocket;
                decision.activityData.spendingCategory = bill.spendingCategory;
                if (bill.paycheckProfile) {
                  decision.activityData.paycheckProfile = bill.paycheckProfile;
                  decision.activityData.isPaycheckActivity = true;
                }
                if ((isTransferBill || decision.activityData.isTransfer) && decision.activityData.amount != null && typeof decision.activityData.amount === 'number') {
                  decision.activityData.amount = Math.abs(decision.activityData.amount);
                }

                insertBill(data, account, bill, decision.activityData, isTransferBill || (decision.activityData.isTransfer ?? false), simulation);
                response.billsEntered++;
                handledAsProjected = true;
              }

              if (!handledAsProjected) {
                const interest = account.interests.find(i => decision.activityId!.startsWith(i.id));
                if (interest && decision.activityData) {
                  decision.activityData.name = 'Interest';
                  decision.activityData.category = 'Banking.Interest';
                  insertInterest(account, interest, decision.activityData, simulation);
                  response.interestsEntered++;
                  handledAsProjected = true;
                }
              }

              if (!handledAsProjected) {
                throw new Error(`Activity not found: ${decision.activityId}`);
              }
              break;
            }
            activity = account.activity[activityIdx];
          } else {
            activityIdx = data.transfers.activity.indexOf(activity);
          }

          const originalIsTransfer = foundInTransfers;
          const newIsTransfer = decision.activityData.isTransfer;

          // Update fields inline (replicate updateSpecificActivity pattern)
          activity.name = decision.activityData.name;
          activity.date = parseDate(decision.activityData.date);
          activity.dateIsVariable = decision.activityData.dateIsVariable;
          activity.dateVariable = decision.activityData.dateVariable;
          activity.category = decision.activityData.category;
          activity.amountIsVariable = decision.activityData.amountIsVariable;
          activity.amount = decision.activityData.amount;
          activity.amountVariable = decision.activityData.amountVariable;
          activity.flag = decision.activityData.flag;
          activity.flagColor = decision.activityData.flagColor;
          activity.isHealthcare = decision.activityData.isHealthcare || false;
          activity.healthcarePerson = decision.activityData.healthcarePerson || null;
          activity.copayAmount = decision.activityData.copayAmount ?? null;
          activity.coinsurancePercent = decision.activityData.coinsurancePercent ?? null;
          activity.countsTowardDeductible = decision.activityData.countsTowardDeductible ?? true;
          activity.countsTowardOutOfPocket = decision.activityData.countsTowardOutOfPocket ?? true;
          activity.spendingCategory = decision.activityData.spendingCategory ?? null;
          activity.paycheckDetails = decision.activityData.paycheckDetails ?? null;
          activity.isPaycheckActivity = decision.activityData.isPaycheckActivity ?? false;
          activity.paycheckProfile = decision.activityData.paycheckProfile ?? null;
          activity.isTransfer = newIsTransfer;
          if (activity.isTransfer) {
            activity.fro = decision.activityData.from;
            activity.to = decision.activityData.to;
          }

          if (activity.isTransfer) {
            activity.amount = Math.abs(Number(activity.amount));
          }

          // Handle transfer conversion: move between arrays if isTransfer changed
          if (!newIsTransfer && originalIsTransfer) {
            // Move from transfers to account
            account.activity.push(activity);
            data.transfers.activity.splice(activityIdx, 1);
          } else if (newIsTransfer && !originalIsTransfer) {
            // Move from account to transfers
            account.activity.splice(activityIdx, 1);
            data.transfers.activity.push(activity);
          }

          response.activitiesUpdated++;
          break;
        }

        case 'enter-bill': {
          if (!decision.billId || !decision.activityData) {
            throw new Error(`enter-bill decision missing billId or activityData`);
          }

          let bill = account.bills.find((b) => b.id === decision.billId);
          let isTransferBill = false;
          if (!bill) {
            bill = data.transfers.bills.find((b) => b.id === decision.billId);
            isTransferBill = !!bill;
          }
          if (!bill) {
            throw new Error(`Bill not found: ${decision.billId}`);
          }

          // Override activityData fields from bill definition
          // Statement provides date + amount; bill provides everything else
          decision.activityData.name = bill.name;
          decision.activityData.category = bill.category;
          decision.activityData.isTransfer = bill.isTransfer;
          decision.activityData.from = bill.fro;
          decision.activityData.to = bill.to;
          // Only override flags from bill if not explicitly cleared by client
          if (decision.activityData.flag === undefined) {
            decision.activityData.flag = bill.flag;
          }
          if (decision.activityData.flagColor === undefined) {
            decision.activityData.flagColor = bill.flagColor;
          }
          decision.activityData.isHealthcare = bill.isHealthcare;
          decision.activityData.healthcarePerson = bill.healthcarePerson;
          decision.activityData.copayAmount = bill.copayAmount;
          decision.activityData.coinsurancePercent = bill.coinsurancePercent;
          decision.activityData.countsTowardDeductible = bill.countsTowardDeductible;
          decision.activityData.countsTowardOutOfPocket = bill.countsTowardOutOfPocket;
          decision.activityData.spendingCategory = bill.spendingCategory;
          if (bill.paycheckProfile) {
            decision.activityData.paycheckProfile = bill.paycheckProfile;
            decision.activityData.isPaycheckActivity = true;
          }

          if ((isTransferBill || decision.activityData.isTransfer) && decision.activityData.amount != null && typeof decision.activityData.amount === 'number') {
            decision.activityData.amount = Math.abs(decision.activityData.amount);
          }

          insertBill(data, account, bill, decision.activityData, isTransferBill || (decision.activityData.isTransfer ?? false), simulation);
          response.billsEntered++;
          break;
        }

        case 'enter-interest': {
          if (!decision.interestId || !decision.activityData) {
            throw new Error(`enter-interest decision missing interestId or activityData`);
          }

          const interest = account.interests.find((i) => i.id === decision.interestId);
          if (!interest) {
            throw new Error(`Interest not found: ${decision.interestId}`);
          }

          // Override activityData fields from interest definition
          // Interest always has fixed name and category
          decision.activityData.name = 'Interest';
          decision.activityData.category = 'Banking.Interest';

          insertInterest(account, interest, decision.activityData, simulation);

          response.interestsEntered++;
          break;
        }

        case 'new-activity': {
          if (!decision.activityData) {
            throw new Error(`new-activity decision missing activityData`);
          }

          if (decision.activityData.isTransfer && decision.activityData.amount != null && typeof decision.activityData.amount === 'number') {
            decision.activityData.amount = Math.abs(decision.activityData.amount);
          }

          const newActivity = new Activity(decision.activityData, simulation);
          if (decision.activityData.isTransfer) {
            data.transfers.activity.push(newActivity);
          } else {
            account.activity.push(newActivity);
          }
          response.activitiesCreated++;
          break;
        }

        case 'skip':
          response.skipped++;
          break;

        case 'delete-activity': {
          if (!decision.activityId) {
            throw new Error('delete-activity decision missing activityId');
          }
          // Try to find in account activities first
          const delIdx = account.activity.findIndex((a) => a.id === decision.activityId);
          if (delIdx !== -1) {
            account.activity.splice(delIdx, 1);
          } else {
            // Try transfers
            const delTransferIdx = data.transfers.activity.findIndex((a) => a.id === decision.activityId);
            if (delTransferIdx !== -1) {
              data.transfers.activity.splice(delTransferIdx, 1);
            } else {
              throw new Error(`Activity not found for deletion: ${decision.activityId}`);
            }
          }
          response.activitiesDeleted++;
          break;
        }

        default:
          throw new Error(`Unknown decision type: ${(decision as any).type}`);
      }
    }

    // Process soft-skips
    for (const softSkip of body.softSkips || []) {
      if (softSkip.type === 'bill') {
        if (!softSkip.billId) {
          throw new Error(`Soft-skip of type 'bill' missing billId`);
        }

        let bill = account.bills.find((b) => b.id === softSkip.billId);
        if (!bill) {
          bill = data.transfers.bills.find((b) => b.id === softSkip.billId);
        }
        if (!bill) {
          throw new Error(`Bill not found for soft-skip: ${softSkip.billId}`);
        }

        bill.skip();
        response.billsSkipped++;
      } else if (softSkip.type === 'interest') {
        if (!softSkip.interestId) {
          throw new Error(`Soft-skip of type 'interest' missing interestId`);
        }

        const interest = account.interests.find((i) => i.id === softSkip.interestId);
        if (!interest) {
          throw new Error(`Interest not found for soft-skip: ${softSkip.interestId}`);
        }

        interest.advance();
        response.interestsSkipped++;
      }
    }

    // Single atomic save
    saveData(data, simulation);

    // Update import memory
    const memory = loadImportMemory();

    // Deep merge transactionMappings
    if (body.memoryUpdates && body.memoryUpdates.transactionMappings) {
      if (!memory.transactionMappings[body.headerHash]) {
        memory.transactionMappings[body.headerHash] = {};
      }
      for (const [key, value] of Object.entries(body.memoryUpdates.transactionMappings)) {
        memory.transactionMappings[body.headerHash][key] = value;
      }
    }

    // Deep merge transferOverrides
    if (body.memoryUpdates && body.memoryUpdates.transferOverrides) {
      for (const [accountId, overrides] of Object.entries(body.memoryUpdates.transferOverrides)) {
        if (!memory.transferOverrides[accountId]) {
          memory.transferOverrides[accountId] = {};
        }
        for (const [name, override] of Object.entries(overrides)) {
          memory.transferOverrides[accountId][name] = override;
        }
      }
    }

    // Add file hash if not already present
    if (!memory.importedFileHashes.includes(body.fileHash)) {
      memory.importedFileHashes.push(body.fileHash);
    }

    saveImportMemory(memory);

    res.json(response);
  } catch (err) {
    console.error('Execute import error:', err);
    const message = err instanceof Error ? err.message : 'Failed to execute import';
    res.status(400).json({ error: message });
  }
}
