import {
  CalculationOptions,
  Segment,
  SegmentResult,
  EventType,
  ActivityEvent,
  BillEvent,
  InterestEvent,
  ActivityTransferEvent,
  BillTransferEvent,
  PensionEvent,
  SocialSecurityEvent,
  TaxEvent,
  RMDEvent,
  SpendingTrackerEvent,
  TimelineEvent,
  TaxableOccurrence,
  WithholdingOccurrence,
  RothConversionEvent,
  MedicarePremiumEvent,
  MedicareHospitalEvent,
  AcaPremiumEvent,
  LTCCheckEvent,
} from './types';
import { CacheManager } from './cache';
import { BalanceTracker } from './balance-tracker';
import { Calculator } from './calculator';
import { PushPullHandler } from './push-pull-handler';
import { ConsolidatedActivity } from '../../data/activity/consolidatedActivity';
import dayjs from 'dayjs';
import { RetirementManager } from './retirement-manager';
import { TaxManager } from './tax-manager';
import { AccountManager } from './account-manager';
import { HealthcareManager } from './healthcare-manager';
import { SpendingTrackerManager } from './spending-tracker-manager';
import type { DebugLogger } from './debug-logger';
import { AssetManager } from './asset-manager';

export class SegmentProcessor {
  private cache: CacheManager;
  private balanceTracker: BalanceTracker;
  private calculator: Calculator;
  private pushPullHandler: PushPullHandler;
  private retirementManager: RetirementManager;
  private taxManager: TaxManager;
  private accountManager: AccountManager;
  private healthcareManager: HealthcareManager;
  private spendingTrackerManager: SpendingTrackerManager;
  private assetManager: AssetManager | null;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';

  constructor(
    cache: CacheManager,
    balanceTracker: BalanceTracker,
    calculator: Calculator,
    pushPullHandler: PushPullHandler,
    retirementManager: RetirementManager,
    taxManager: TaxManager,
    accountManager: AccountManager,
    healthcareManager: HealthcareManager,
    spendingTrackerManager: SpendingTrackerManager,
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
    assetManager?: AssetManager | null,
  ) {
    this.cache = cache;
    this.balanceTracker = balanceTracker;
    this.calculator = calculator;
    this.pushPullHandler = pushPullHandler;
    this.retirementManager = retirementManager;
    this.taxManager = taxManager;
    this.accountManager = accountManager;
    this.healthcareManager = healthcareManager;
    this.spendingTrackerManager = spendingTrackerManager;
    this.assetManager = assetManager ?? null;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'segment', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  async processSegment(segment: Segment, options: CalculationOptions): Promise<void> {
    if (!this.balanceTracker) {
      throw new Error('Balance tracker not initialized');
    }

    this.log('segment-started', {
      startDate: dayjs.utc(segment.startDate).format('YYYY-MM-DD'),
      endDate: dayjs.utc(segment.endDate).format('YYYY-MM-DD'),
      eventCount: segment.events.length,
    });

    if (options.forceRecalculation || options.monteCarlo) {
      this.log('cache-skip', {
        segmentId: segment.id,
        startDate: dayjs.utc(segment.startDate).format('YYYY-MM-DD'),
        endDate: dayjs.utc(segment.endDate).format('YYYY-MM-DD'),
        reason: options.forceRecalculation ? 'forceRecalculation' : 'monteCarlo',
      });
    }
    // Check if segment result is cached (will return null if monteCarlo is true)
    if (!options.forceRecalculation && !options.monteCarlo) {
      const cachedResult = await this.cache.getSegmentResult(segment);
      if (cachedResult) {
        this.log('cache-hit', {
          segmentId: segment.id,
          startDate: dayjs.utc(segment.startDate).format('YYYY-MM-DD'),
          endDate: dayjs.utc(segment.endDate).format('YYYY-MM-DD'),
        });
        this.balanceTracker.applySegmentResult(cachedResult, segment.startDate);

        // Restore healthcare manager state from cached activities
        // This is critical for deductible/OOP tracking to work correctly across segment boundaries
        if (cachedResult.activitiesAdded && this.healthcareManager) {
          let healthcareActivitiesReprocessed = 0;
          for (const [_accountId, activities] of cachedResult.activitiesAdded) {
            for (const activity of activities) {
              if (activity.isHealthcare && activity.healthcarePerson) {
                healthcareActivitiesReprocessed++;
                const config = this.healthcareManager.getActiveConfig(
                  activity.healthcarePerson,
                  new Date(activity.date)
                );
                if (config) {
                  // Replay through calculatePatientCost to rebuild tracking state
                  // The idempotency cache prevents duplicate calculations
                  this.healthcareManager.calculatePatientCost(
                    activity as any,  // ConsolidatedActivity has the necessary fields (name, amount, date)
                    config,
                    new Date(activity.date)
                  );
                }
              }
            }
          }
          this.log('healthcare-state-restored', { activitiesReprocessed: healthcareActivitiesReprocessed });
        }

        // Record tagged spending from cached results for cross-segment period tracking
        this.spendingTrackerManager.recordSegmentActivities(cachedResult);

        // Replay spending tracker state changes (carry, reset, markPeriodProcessed)
        // that were recorded when this segment was originally processed.
        // Without this, carry-over/carry-under state is lost when loading from cache.
        if (cachedResult.spendingTrackerUpdates) {
          for (const update of cachedResult.spendingTrackerUpdates) {
            this.spendingTrackerManager.setCarryBalance(update.categoryId, update.carryAfter);
            this.spendingTrackerManager.resetPeriodSpending(update.categoryId);
            this.spendingTrackerManager.markPeriodProcessed(update.categoryId, update.periodEnd);
          }
        }

        // Replay taxable occurrences from cached segments into TaxManager
        // Without this, tax reconciliation is missing income from cached segments
        for (const [accountName, taxableOccurrences] of cachedResult.taxableOccurrences) {
          const account = this.accountManager.getAccountByName(accountName);
          if (account) {
            this.taxManager.addTaxableOccurrences(account.id, taxableOccurrences);
          }
        }

        // Replay withholding occurrences from cached segments into TaxManager
        if (cachedResult.withholdingOccurrences) {
          for (const [_key, withholdingOccurrences] of cachedResult.withholdingOccurrences) {
            for (const wh of withholdingOccurrences) {
              this.taxManager.addWithholdingOccurrence(wh);
            }
          }
        }

        // Replay FICA occurrences from cached segments into TaxManager
        if (cachedResult.ficaOccurrences) {
          for (const [year, occurrences] of cachedResult.ficaOccurrences) {
            for (const f of occurrences) {
              this.taxManager.addFicaOccurrence(year, f.source, f.ssTax, f.medicareTax);
            }
          }
        }

        return;
      }
      // Log cache-miss immediately after null cache result
      this.log('cache-miss', {
        segmentId: segment.id,
        startDate: dayjs.utc(segment.startDate).format('YYYY-MM-DD'),
        endDate: dayjs.utc(segment.endDate).format('YYYY-MM-DD'),
      });
    }

    this.log('segment-compute-start', {
      segmentId: segment.id,
      startDate: dayjs.utc(segment.startDate).format('YYYY-MM-DD'),
      endDate: dayjs.utc(segment.endDate).format('YYYY-MM-DD'),
    });

    // Save spending tracker, healthcare, calculator, asset, and tax state
    // BEFORE processing any events in this segment. These checkpoints are restored if push-pull reprocess fires,
    // ensuring the second pass doesn't double-write to managers that accumulate per-event state.
    this.spendingTrackerManager.checkpoint();
    this.healthcareManager.checkpoint();
    this.calculator.checkpoint();
    this.assetManager?.checkpoint();
    this.taxManager.checkpoint();

    // Process events in the segment
    let segmentResult = this.processSegmentEvents(segment, options);

    // Deal with pushes and pulls
    // Use today (or options.startDate if it's in the future) as the reference date to prevent auto-push/pull before the current date
    const today = new Date();
    const referenceDate = options.startDate && options.startDate > today ? options.startDate : today;
    const pushPullEventsAdded = this.pushPullHandler.handleAccountPushPulls(segmentResult, segment, referenceDate);
    this.log('push-pull-executed', { eventsAdded: pushPullEventsAdded });

    // If a push or pull was added, reprocess the segment events
    if (pushPullEventsAdded) {
      this.log('segment-reprocessed', { reason: 'push-pull-added' });
      this.spendingTrackerManager.restore();
      this.healthcareManager.restore();
      this.calculator.restore();
      this.assetManager?.restore();
      this.taxManager.restore();
      segmentResult = this.processSegmentEvents(segment, options);
    }

    // Record tagged spending from the FINAL segment result
    this.spendingTrackerManager.recordSegmentActivities(segmentResult);

    // Cache the segment result (will skip if monteCarlo is true)
    if (!options.monteCarlo) {
      await this.cache.setSegmentResult(segment, segmentResult);
      this.log('cache-populate', {
        segmentId: segment.id,
        startDate: dayjs.utc(segment.startDate).format('YYYY-MM-DD'),
        endDate: dayjs.utc(segment.endDate).format('YYYY-MM-DD'),
      });
    }

    // Apply the result to balance tracker
    this.balanceTracker.applySegmentResult(segmentResult, segment.startDate);

    // Add relevant activities to retirement incomes
    for (const [_accountId, activities] of segmentResult.activitiesAdded) {
      activities.forEach((activity) => {
        // Skip paycheck activities — they're already handled in calculator.ts via grossPay
        // to avoid double-counting AIME wages (net pay + gross pay)
        if (!(activity as any).isPaycheckActivity) {
          // Add the income to the retirement manager if it is a valid income name
          this.retirementManager.tryAddToAnnualIncomes(activity.name, activity.date, activity.amount as number);
        }
      });
    }

    // Add taxable occurences to tax manager
    for (const [accountName, taxableOccurrences] of segmentResult.taxableOccurrences) {
      const account = this.accountManager.getAccountByName(accountName);
      if (account) {
        this.taxManager.addTaxableOccurrences(account.id, taxableOccurrences);
        for (const occ of taxableOccurrences) {
          this.log('taxable-occurrence-routed', {
            accountName,
            amount: occ.amount,
            incomeType: occ.incomeType,
            year: occ.year,
          });
        }
      } else {
        this.log('taxable-occurrence-account-not-found', { accountName });
      }
    }
  }

  private processSegmentEvents(segment: Segment, options: CalculationOptions): SegmentResult {
    const segmentResult: SegmentResult = {
      balanceChanges: new Map<string, number>(),
      activitiesAdded: new Map<string, ConsolidatedActivity[]>(),
      processedEventIds: new Set<string>(),
      balanceMinimums: new Map<string, number>(),
      balanceMaximums: new Map<string, number>(),
      taxableOccurrences: new Map<string, TaxableOccurrence[]>(),
      withholdingOccurrences: new Map<string, WithholdingOccurrence[]>(),
      ficaOccurrences: new Map<number, Array<{ source: string; ssTax: number; medicareTax: number }>>(),
      spendingTrackerUpdates: [],
    };

    // Inject any pending payouts from inheritance/life insurance managers
    this.calculator.injectPendingPayouts(segmentResult);

    // Group events by date for efficient processing
    const eventsByDate = this.groupEventsByDate(segment.events);

    // Get the initial balance for each affected account (before this segment)
    const currentBalances = new Map<string, number>();
    for (const accountId of segment.affectedAccountIds) {
      currentBalances.set(accountId, this.balanceTracker.getAccountBalance(accountId));
    }

    for (const [_, dayEvents] of [...eventsByDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      // Process events for this date
      const dayBalanceChanges = this.processDayEvents(dayEvents, options, segmentResult);

      // Update current and minimum/maximum balances
      for (const [accountId, change] of dayBalanceChanges) {
        const currentBalance = currentBalances.get(accountId) || 0;
        const newBalance = currentBalance + change;

        // Track minimum and maximum balances
        const minBalance = segmentResult.balanceMinimums.get(accountId) || newBalance;
        const maxBalance = segmentResult.balanceMaximums.get(accountId) || newBalance;

        segmentResult.balanceMinimums.set(accountId, Math.min(minBalance, newBalance));
        segmentResult.balanceMaximums.set(accountId, Math.max(maxBalance, newBalance));

        // Update current balance for next iteration
        currentBalances.set(accountId, newBalance);
      }
    }

    return segmentResult;
  }

  private groupEventsByDate(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
    const eventsByDate = new Map<string, TimelineEvent[]>();

    for (const event of events) {
      const dateKey = dayjs.utc(event.date).format('YYYY-MM-DD');

      if (!eventsByDate.has(dateKey)) {
        eventsByDate.set(dateKey, []);
      }

      eventsByDate.get(dateKey)!.push(event);
    }

    return eventsByDate;
  }

  /**
   * Processes events for a single day
   * @param events - Events for the day
   * @param options - Calculation options
   * @param segmentResult - Result object to store changes
   * @returns Map of accountId to total balance change for the day
   */
  private processDayEvents(
    events: TimelineEvent[],
    options: CalculationOptions,
    segmentResult: SegmentResult,
  ): Map<string, number> {
    // Set the current date for debug logging on this processor and the calculator
    if (events.length > 0) {
      this.currentDate = dayjs.utc(events[0].date).format('YYYY-MM-DD');
      this.calculator.setCurrentDate(this.currentDate);
    }

    // Sort events by priority, then by name for consistent ordering
    const sortedEvents = [...events].sort((a, b) => {
      // Primary sort by priority
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      // Secondary sort by name (A-Z) for same-priority events
      const nameA = this.getEventName(a);
      const nameB = this.getEventName(b);
      return nameA.localeCompare(nameB);
    });
    const dayBalanceChanges = new Map<string, number>();
    for (const event of sortedEvents) {
      const balanceChanges = this.processEvent(event, options, segmentResult);
      // Merge balance changes into the day's total
      for (const [accountId, change] of balanceChanges.entries()) {
        const currentChange = dayBalanceChanges.get(accountId) || 0;
        dayBalanceChanges.set(accountId, currentChange + change);
      }
      segmentResult.processedEventIds.add(event.id);
    }
    if (sortedEvents.length > 0) {
      this.log('day-events-processed', {
        date: dayjs.utc(sortedEvents[0].date).format('YYYY-MM-DD'),
        eventCount: sortedEvents.length,
        balanceChangesCount: dayBalanceChanges.size,
      });
    }
    return dayBalanceChanges;
  }

  /**
   * Processes a single event
   * @param event - The event to process
   * @param options - Calculation options
   * @param segmentResult - Result object to store changes
   * @return Map of accountId to balance change for the event
   */
  private processEvent(
    event: TimelineEvent,
    options: CalculationOptions,
    segmentResult: SegmentResult,
  ): Map<string, number> {
    if (!this.calculator) {
      throw new Error('Calculator not initialized');
    }
    switch (event.type) {
      case EventType.activity:
        return this.calculator.processActivityEvent(event as ActivityEvent, segmentResult);
      case EventType.bill:
        return this.calculator.processBillEvent(event as BillEvent, segmentResult, options.simulation);
      case EventType.interest:
        return this.calculator.processInterestEvent(event as InterestEvent, segmentResult);
      case EventType.activityTransfer:
        return this.calculator.processActivityTransferEvent(event as ActivityTransferEvent, segmentResult);
      case EventType.billTransfer:
        return this.calculator.processBillTransferEvent(event as BillTransferEvent, segmentResult);
      case EventType.pension:
        return this.calculator.processPensionEvent(event as PensionEvent, segmentResult);
      case EventType.socialSecurity:
        return this.calculator.processSocialSecurityEvent(event as SocialSecurityEvent, segmentResult);
      case EventType.tax:
        return this.calculator.processTaxEvent(event as TaxEvent, segmentResult);
      case EventType.rmd:
        return this.calculator.processRMDEvent(event as RMDEvent, segmentResult);
      case EventType.rothConversion:
        return this.calculator.processRothConversionEvent(event as RothConversionEvent, segmentResult);
      case EventType.spendingTracker:
        return this.calculator.processSpendingTrackerEvent(event as SpendingTrackerEvent, segmentResult);
      case EventType.medicarePremium:
        return this.calculator.processMedicarePremiumEvent(event as MedicarePremiumEvent, segmentResult);
      case EventType.medicareHospital:
        return this.calculator.processMedicareHospitalEvent(event as MedicareHospitalEvent, segmentResult);
      case EventType.acaPremium:
        return this.calculator.processAcaPremiumEvent(event as AcaPremiumEvent, segmentResult);
      case EventType.ltcCheck:
        return this.calculator.processLTCCheckEvent(event as LTCCheckEvent, segmentResult);
      default:
        this.log('unknown-event-type', { type: event.type });
        return new Map<string, number>();
    }
  }

  /**
   * Extracts the name from an event for sorting purposes
   * @param event - The event to get the name from
   * @returns The name of the event
   */
  private getEventName(event: TimelineEvent): string {
    switch (event.type) {
      case EventType.activity:
        return (event as ActivityEvent).originalActivity.name;
      case EventType.bill:
        return (event as BillEvent).originalBill.name;
      case EventType.interest:
        return 'Interest'; // Interest events don't have a name
      case EventType.pension:
        return 'Pension';
      case EventType.socialSecurity:
        return 'Social Security';
      case EventType.tax:
        return 'Tax';
      case EventType.rmd:
        return 'RMD';
      case EventType.rothConversion:
        return 'Roth Conversion';
      case EventType.spendingTracker:
        return (event as SpendingTrackerEvent).categoryName;
      case EventType.activityTransfer:
        return (event as any).originalActivity?.name || '';
      case EventType.billTransfer:
        return (event as any).originalBill?.name || '';
      case EventType.medicarePremium:
        return (event as MedicarePremiumEvent).personName;
      case EventType.medicareHospital:
        return (event as MedicareHospitalEvent).personName;
      case EventType.ltcCheck:
        return (event as LTCCheckEvent).personName;
      case EventType.acaPremium:
        return (event as AcaPremiumEvent).personName;
      default:
        return ''; // Unknown events sort to the beginning
    }
  }
}
