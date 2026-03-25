import dayjs from 'dayjs';
import crypto from 'crypto';
import { AccountsAndTransfers } from '../../data/account/types';
import {
  ActivityEvent,
  ActivityTransferEvent,
  BillEvent,
  BillTransferEvent,
  CalculationOptions,
  EventType,
  InterestEvent,
  MonteCarloConfig,
  MonteCarloSampleType,
  PensionEvent,
  PortfolioMakeupOverTime,
  RMDEvent,
  Segment,
  SocialSecurityEvent,
  SpendingTrackerEvent,
  TaxEvent,
  TimelineEvent,
  TransferEvent,
  RothConversionEvent,
  MedicarePremiumEvent,
  MedicareHospitalEvent,
  AcaPremiumEvent,
  LTCCheckEvent,
} from './types';
import { getPortfolioComposition, computeBlendedReturn } from './portfolio-utils';
import { Account } from '../../data/account/account';
import { Bill } from '../../data/bill/bill';
import { Interest } from '../../data/interest/interest';
import { formatDate, isAfterOrSame, isBeforeOrSame, isSame, nextDate } from '../date/date';
import { AccountManager } from './account-manager';
import { Pension } from '../../data/retirement/pension/pension';
import { SocialSecurity } from '../../data/retirement/socialSecurity/socialSecurity';
import { SpendingTrackerCategory } from '../../data/spendingTracker/types';
import { computePeriodBoundaries } from './period-utils';
import { loadVariable } from '../simulation/variable';
import { getPersonGender } from '../io/persons';
import type { DebugLogger } from './debug-logger';

export class Timeline {
  private accountManager: AccountManager;
  private events: TimelineEvent[];
  private segments: Segment[];
  private eventIndex: Map<string, TimelineEvent>;
  private calculationBegin: number;
  private enableLogging: boolean;
  private monteCarloConfig: MonteCarloConfig | null;
  private simulation: string;
  private debugLogger: DebugLogger | null;
  private simNumber: number;
  private currentDate: string = '';
  private portfolioMakeup: PortfolioMakeupOverTime | null = null;
  private cutoffDates: Map<string, string> | null = null;

  constructor(
    accountManager: AccountManager,
    calculationBegin: number,
    enableLogging: boolean,
    monteCarloConfig: MonteCarloConfig | null = null,
    simulation: string = 'Default',
    debugLogger?: DebugLogger | null,
    simNumber: number = 0,
  ) {
    this.accountManager = accountManager;
    this.events = [];
    this.segments = [];
    this.eventIndex = new Map();
    this.calculationBegin = calculationBegin;
    this.enableLogging = enableLogging;
    this.monteCarloConfig = monteCarloConfig;
    this.simulation = simulation;
    this.debugLogger = debugLogger ?? null;
    this.simNumber = simNumber;
  }

  private log(event: string, data?: Record<string, unknown>): void {
    if (!this.debugLogger) return;
    this.debugLogger.log(this.simNumber, { component: 'timeline', event, ...(this.currentDate ? { ts: this.currentDate } : {}), ...data });
  }

  /**
   * Clones the timeline and all its events. It re-uses the same account manager.
   */
  clone(startDate: Date, endDate: Date, monteCarloConfig: MonteCarloConfig | null = null) {
    const clonedTimeline = new Timeline(
      this.accountManager,
      this.calculationBegin,
      this.enableLogging,
      monteCarloConfig,
      this.simulation,
      this.debugLogger,
      this.simNumber,
    );

    // Propagate portfolio makeup data
    clonedTimeline.portfolioMakeup = this.portfolioMakeup;

    // Clone events and sort them
    clonedTimeline.events = this.events.map((event) => Timeline.cloneEvent(event));
    clonedTimeline.sortEvents();
    clonedTimeline.createSegments(startDate, endDate);
    return clonedTimeline;
  }

  private static cloneEvent(event: TimelineEvent): TimelineEvent {
    return { ...event, date: new Date(event.date.getTime()) };
  }

  applyMonteCarlo() {
    const mappings = this.monteCarloConfig?.variableMappings || {};
    let eventsModified = 0;

    for (const event of this.events) {
      if (event.type === EventType.bill) {
        const billEvent = event as BillEvent;
        const varName = billEvent.originalBill.increaseByVariable;
        if (varName && mappings[varName]) {
          billEvent.amount = this.calculateBillAmountMonteCarlo(billEvent.originalBill, billEvent.date, mappings[varName]);
          eventsModified++;
        }
      } else if (event.type === EventType.billTransfer) {
        const billTransferEvent = event as BillTransferEvent;
        const varName = billTransferEvent.originalBill.increaseByVariable;
        if (varName && mappings[varName]) {
          billTransferEvent.amount = this.calculateBillAmountMonteCarlo(
            billTransferEvent.originalBill,
            billTransferEvent.date,
            mappings[varName],
          );
          eventsModified++;
        }
      } else if (event.type === EventType.interest) {
        const interestEvent = event as InterestEvent;
        const varName = interestEvent.originalInterest.aprVariable;
        if (varName && mappings[varName]) {
          interestEvent.rate = this.monteCarloConfig?.handler?.getSample(
            mappings[varName] as MonteCarloSampleType,
            interestEvent.date,
          ) ?? interestEvent.rate;
          eventsModified++;
        }
      }
    }
    this.log('mc-applied', { eventsModified });
  }

  setPortfolioMakeup(makeup: PortfolioMakeupOverTime | null): void {
    this.portfolioMakeup = makeup;
  }

  setCutoffDates(cutoffs: Map<string, string>): void {
    this.cutoffDates = cutoffs;
  }

  /**
   * Adjust INVESTMENT_RATE interest events for deterministic mode using the
   * portfolio glide path.  For each such event we look up the asset-class
   * allocation for that year and compute a blended return from the per-class
   * variables (STOCK_RETURN, BOND_RETURN, CASH_RETURN).
   */
  applyGlidePath(): void {
    if (!this.portfolioMakeup) return;

    // Resolve deterministic asset-class return variables
    let stockReturn: number;
    let bondReturn: number;
    let cashReturn: number;
    try {
      stockReturn = Number(loadVariable('STOCK_RETURN', this.simulation));
      bondReturn = Number(loadVariable('BOND_RETURN', this.simulation));
      cashReturn = Number(loadVariable('CASH_RETURN', this.simulation));
    } catch {
      // Variables not defined in this simulation — skip glide-path adjustment
      this.log('glide-path-skipped', { reason: 'missing asset-class return variables' });
      return;
    }

    // If any variable resolved to NaN, skip glide-path adjustment
    if (isNaN(stockReturn) || isNaN(bondReturn) || isNaN(cashReturn)) {
      this.log('glide-path-skipped', { reason: 'asset-class return variables are NaN' });
      return;
    }

    let eventsModified = 0;
    for (const event of this.events) {
      if (event.type === EventType.interest) {
        const interestEvent = event as InterestEvent;
        if (interestEvent.originalInterest.aprVariable === 'INVESTMENT_RATE') {
          const composition = getPortfolioComposition(this.portfolioMakeup, interestEvent.date);
          const blended = computeBlendedReturn(composition, stockReturn, bondReturn, cashReturn);
          interestEvent.rate = blended;
          eventsModified++;
        }
      }
    }
    this.log('glide-path-applied', { eventsModified, stockReturn, bondReturn, cashReturn });
  }

  getAccountManager(): AccountManager {
    return this.accountManager;
  }

  static async fromAccountsAndTransfers(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
    calculationBegin: number,
    enableLogging: boolean,
    monteCarloConfig: MonteCarloConfig | null = null,
    calculationOptions: CalculationOptions,
    spendingTrackerCategories: SpendingTrackerCategory[] = [],
  ): Promise<Timeline> {
    const accountManager = new AccountManager(accountsAndTransfers.accounts, calculationOptions);
    const timeline = new Timeline(accountManager, calculationBegin, enableLogging, monteCarloConfig, calculationOptions.simulation, calculationOptions.debugLogger, calculationOptions.simulationNumber ?? 0);

    // Parallelize all independent add* method calls
    await Promise.all([
      timeline.addActivityEvents(accountsAndTransfers, endDate),
      timeline.addBillEvents(accountsAndTransfers, endDate),
      timeline.addInterestEvents(accountsAndTransfers, endDate),
      timeline.addTransferActivityEvents(accountsAndTransfers, endDate),
      timeline.addTransferBillEvents(accountsAndTransfers, endDate),
      timeline.addSocialSecurityEvents(endDate),
      timeline.addPensionEvents(endDate),
      timeline.addRmdEvents(accountsAndTransfers, startDate, endDate),
      timeline.addTaxEvents(accountsAndTransfers, startDate, endDate, calculationOptions),
      timeline.addRothConversionEvents(startDate, endDate, calculationOptions),
      timeline.addSpendingTrackerEvents(spendingTrackerCategories, startDate, endDate),
      timeline.addMedicareEvents(accountsAndTransfers, startDate, endDate),
      timeline.addAcaEvents(startDate, endDate, calculationOptions),
      timeline.addLTCEvents(startDate, endDate, calculationOptions),
    ]);

    // Sort and optimize timeline
    if (enableLogging) {
      console.log('  Sorting events', Date.now() - timeline.calculationBegin, 'ms');
    }
    timeline.sortEvents();
    if (enableLogging) {
      console.log('  Creating segments', Date.now() - timeline.calculationBegin, 'ms');
    }
    timeline.createSegments(startDate, endDate);

    return timeline;
  }

  /**************************************************
   * ADD EVENTS
   **************************************************/

  /**
   * Adds manual activity events to the timeline
   * Excludes transfer activities since they're handled separately in addTransferEvents method
   */
  private async addActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    const countBefore = this.events.length;
    for (const account of accountsAndTransfers.accounts) {
      for (const activity of account.activity) {
        if (activity.isTransfer) {
          continue;
        }

        // Skip activities before portfolio cutoff date
        if (this.cutoffDates?.has(account.id)) {
          const cutoffDate = this.cutoffDates.get(account.id);
          if (cutoffDate && activity.date <= new Date(cutoffDate + 'T00:00:00Z')) {
            continue;
          }
        }

        if (activity.date <= endDate) {
          const event: ActivityEvent = {
            id: `activity_${account.id}_${activity.id}`,
            type: EventType.activity,
            date: activity.date,
            accountId: account.id,
            priority: 1,
            originalActivity: activity,
          };

          this.addEvent(event);
        }
      }
    }
    this.log('activity-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding activity events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    const countBefore = this.events.length;
    for (const account of accountsAndTransfers.accounts) {
      for (const bill of account.bills) {
        this.generateBillEvents(account, bill, endDate);
      }
    }
    this.log('bill-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding bill events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addInterestEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    const countBefore = this.events.length;
    for (const account of accountsAndTransfers.accounts) {
      this.generateInterestEvents(account, account.interests, endDate);
    }
    this.log('interest-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding interest events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addTransferActivityEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    for (const activity of accountsAndTransfers.transfers.activity) {
      if (activity.date <= endDate && activity.isTransfer) {
        if (!activity.fro || !activity.to) {
          this.log('transfer-activity-missing-accounts', { activityName: activity.name, from: activity.fro ?? null, to: activity.to ?? null });
          continue;
        }
        const fromAccount = this.accountManager.getAccountByName(activity.fro);
        const toAccount = this.accountManager.getAccountByName(activity.to);
        if (!fromAccount && !toAccount) {
          this.log('transfer-activity-account-not-found', { activityName: activity.name, from: activity.fro, to: activity.to });
          continue;
        }

        // Handle cases where only one account is present (partial transfer processing)
        let shouldProcessTransfer = false;
        let accountsToProcess: { account: Account; isSource: boolean }[] = [];

        if (fromAccount) {
          accountsToProcess.push({ account: fromAccount, isSource: true });
          shouldProcessTransfer = true;
        }

        if (toAccount) {
          accountsToProcess.push({ account: toAccount, isSource: false });
          shouldProcessTransfer = true;
        }

        if (!shouldProcessTransfer) {
          this.log('transfer-activity-skipped', { activityName: activity.name });
          continue;
        }

        const event: ActivityTransferEvent = {
          id: `transfer_${activity.id}_from_${fromAccount?.id}_to_${toAccount?.id}`,
          type: EventType.activityTransfer,
          fromAccountId: fromAccount?.id || '',
          toAccountId: toAccount?.id || '',
          date: activity.date,
          accountId: fromAccount?.id || toAccount?.id || '',
          originalActivity: activity,
          priority: 1,
        };

        this.addEvent(event);
      }
    }
    if (this.enableLogging) {
      console.log('  Finished adding transfer activity events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addTransferBillEvents(accountsAndTransfers: AccountsAndTransfers, endDate: Date): Promise<void> {
    for (const bill of accountsAndTransfers.transfers.bills) {
      this.generateTransferBillEvents(bill, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding transfer bill events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addSocialSecurityEvents(endDate: Date): Promise<void> {
    for (const socialSecurity of this.accountManager.getSocialSecurities()) {
      this.generateSocialSecurityEvents(socialSecurity, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding social security events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addPensionEvents(endDate: Date): Promise<void> {
    for (const pension of this.accountManager.getPensions()) {
      this.generatePensionEvents(pension, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding pension events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addRmdEvents(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    for (const account of accountsAndTransfers.accounts) {
      this.generateRmdEvents(account, startDate, endDate);
    }
    if (this.enableLogging) {
      console.log('  Finished adding RMD events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addTaxEvents(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
    calculationOptions?: CalculationOptions,
  ): Promise<void> {
    const countBefore = this.events.length;
    // Tax events should be generated once per year (not per account).
    // Use the explicitly configured taxAccountName from taxConfig.json,
    // falling back to the first performsPulls/interest-paying account.
    let taxAccount: Account | undefined;

    if (calculationOptions?.taxAccountName) {
      taxAccount = this.accountManager.getAccountByName(calculationOptions.taxAccountName);
    }

    if (!taxAccount) {
      const interestPayNames = this.accountManager.getInterestPayAccountNames();
      taxAccount = accountsAndTransfers.accounts.find(
        (a) => a.performsPulls || interestPayNames.has(a.name),
      );
    }

    if (taxAccount) {
      this.generateTaxEvents(taxAccount, startDate, endDate);
    }
    this.log('tax-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding tax events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addRothConversionEvents(
    startDate: Date,
    endDate: Date,
    calculationOptions: CalculationOptions,
  ): Promise<void> {
    const countBefore = this.events.length;
    this.generateRothConversionEvents(startDate, endDate, calculationOptions);
    this.log('roth-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding Roth conversion events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addMedicareEvents(
    accountsAndTransfers: AccountsAndTransfers,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const countBefore = this.events.length;
    // Get all Social Securities (these have birth dates)
    const socialSecurities = this.accountManager.getSocialSecurities();

    for (const socialSecurity of socialSecurities) {
      // Load birth date from variable
      let birthDate: Date | null = null;
      if (socialSecurity.birthDateVariable) {
        try {
          const birthDateStr = loadVariable(socialSecurity.birthDateVariable, this.simulation) as string;
          if (birthDateStr) {
            birthDate = new Date(birthDateStr);
          }
        } catch (error) {
          this.log('medicare-birthdate-variable-error', { variable: socialSecurity.birthDateVariable, name: socialSecurity.name });
        }
      }

      if (!birthDate) {
        continue; // Skip if no birth date available
      }

      // Find the account for payouts (assume Medicare comes from the same account as SS)
      const payOutAccount = this.accountManager.getAccountByName(socialSecurity.payToAccount);
      if (!payOutAccount) {
        this.log('medicare-payout-account-not-found', { payToAccount: socialSecurity.payToAccount });
        continue;
      }

      // Calculate 65th birthday
      const age65Date = dayjs.utc(birthDate).add(65, 'year').toDate();

      // Generate Medicare premium events (monthly from age 65 through endDate)
      this.generateMedicarePremiumEvents(
        socialSecurity.name,
        age65Date,
        endDate,
        payOutAccount.id,
        birthDate,
      );

      // Generate Medicare hospital admission events (annual starting at age 65)
      this.generateMedicareHospitalEvents(
        socialSecurity.name,
        age65Date,
        endDate,
        payOutAccount.id,
        birthDate,
      );
    }

    this.log('medicare-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding Medicare events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addLTCEvents(startDate: Date, endDate: Date, calculationOptions: CalculationOptions): Promise<void> {
    // LTC events are generated per-person from insurance purchase age onward (default 60)
    // Markov chain only steps when age >= 65, but premiums start at purchase age
    const socialSecurities = this.accountManager.getSocialSecurities();

    // Find payment account using configured tax account name
    const paymentAccount = calculationOptions.taxAccountName
      ? this.accountManager.getAccountByName(calculationOptions.taxAccountName)
      : undefined;
    if (!paymentAccount) {
      if (this.enableLogging) {
        console.log(`  Payment account (${calculationOptions.taxAccountName ?? 'undefined'}) not found, skipping LTC events`);
      }
      return;
    }

    // Generate LTC events for each person
    this.log('ltc-events-start', { ssCount: socialSecurities.length, paymentAccount: paymentAccount.name });
    let monthIndex = 0;
    for (const socialSecurity of socialSecurities) {
      if (!socialSecurity.birthDateVariable) {
        continue; // Skip if no birth date
      }

      try {
        const birthDateStr = loadVariable(socialSecurity.birthDateVariable, this.simulation) as string;
        if (!birthDateStr) {
          continue;
        }

        const birthDate = new Date(birthDateStr);
        const age60Date = dayjs.utc(birthDate).add(60, 'year').toDate();

        // Extract person name by removing " Social Security" suffix
        const personName = socialSecurity.name.replace(' Social Security', '');

        const gender = getPersonGender(personName);

        // Start events from age 60 (insurance purchase age)
        const eventStartDate = age60Date;

        this.generateLTCCheckEvents(
          personName,
          gender,
          eventStartDate,
          endDate,
          paymentAccount.id,
          birthDate,
          startDate,
          monthIndex,
        );

        this.log('ltc-events-person-generated', { person: personName, gender, age60: age60Date.toISOString(), eventStart: eventStartDate.toISOString() });
        monthIndex = 0; // Reset for next person (independent month counters)
      } catch (error) {
        this.log('ltc-events-person-error', { person: socialSecurity.name, error: String(error) });
      }
    }

    if (this.enableLogging) {
      console.log('  Finished adding LTC events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addAcaEvents(startDate: Date, endDate: Date, calculationOptions: CalculationOptions): Promise<void> {
    const countBefore = this.events.length;
    const socialSecurities = this.accountManager.getSocialSecurities();

    // Load retirement date
    const retireDateResult = loadVariable('RETIRE_DATE', this.simulation);
    if (!retireDateResult) {
      if (this.enableLogging) {
        console.log('  No retirement date found, skipping ACA events');
      }
      return;
    }
    const retireDate = new Date(retireDateResult as string);

    // Find payment account using configured tax account name
    const paymentAccount = calculationOptions.taxAccountName
      ? this.accountManager.getAccountByName(calculationOptions.taxAccountName)
      : undefined;
    if (!paymentAccount) {
      if (this.enableLogging) {
        console.log(`  Payment account (${calculationOptions.taxAccountName ?? 'undefined'}) not found, skipping ACA events`);
      }
      return;
    }

    // Get both persons' birth dates
    const birthDates: Date[] = [];
    for (const ss of socialSecurities) {
      if (ss.birthDateVariable) {
        try {
          const birthDateStr = loadVariable(ss.birthDateVariable, this.simulation) as string;
          if (birthDateStr) {
            birthDates.push(new Date(birthDateStr));
          }
        } catch (error) {
          this.log('aca-birthdate-variable-error', { variable: ss.birthDateVariable });
        }
      }
    }

    if (birthDates.length < 2) {
      if (this.enableLogging) {
        console.log('  Both birth dates needed for ACA household events, skipping');
      }
      return;
    }

    // Find the later age-65 date (when last person leaves ACA for Medicare)
    const age65Date1 = dayjs.utc(birthDates[0]).add(65, 'year').toDate();
    const age65Date2 = dayjs.utc(birthDates[1]).add(65, 'year').toDate();
    const laterAge65Date = age65Date1 > age65Date2 ? age65Date1 : age65Date2;

    // Generate ONE set of household ACA events from retirement to later age-65
    this.generateAcaPremiumEvents(
      'Household',
      retireDate,
      laterAge65Date,
      paymentAccount.id,
      birthDates[0],
      birthDates[1],
      startDate,
      endDate,
    );

    this.log('aca-events-added', { count: this.events.length - countBefore });
    if (this.enableLogging) {
      console.log('  Finished adding ACA events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  private async addSpendingTrackerEvents(
    categories: SpendingTrackerCategory[],
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    for (const category of categories) {
      const boundaries = computePeriodBoundaries(
        category.interval,
        category.intervalStart,
        startDate,
        endDate,
      );

      // Compute startDate as the first day of the current period.
      // Periods ending before today's period start are virtual:
      // they process carry but don't create remainder activities.
      const today = dayjs.utc().startOf('day');
      const todayBoundaries = computePeriodBoundaries(
        category.interval,
        category.intervalStart,
        today.subtract(1, 'year').toDate(),
        today.add(1, 'day').toDate(),
      );
      const currentPeriod = todayBoundaries.find(
        b => !dayjs.utc(b.periodStart).isAfter(today, 'day') && !dayjs.utc(b.periodEnd).isBefore(today, 'day'),
      );
      const computedStartDate = currentPeriod ? dayjs.utc(currentPeriod.periodStart) : today;
      let isFirstReal = true;

      for (const period of boundaries) {
        const isVirtual = dayjs.utc(period.periodEnd).isBefore(computedStartDate, 'day');

        // Use noon UTC (12:00) instead of midnight UTC (00:00) to prevent
        // timezone shifts when local-time Date methods are used elsewhere.
        // Midnight UTC becomes the previous day in US timezones (e.g., EST = UTC-5),
        // causing events to appear one day early. Noon UTC is safe for any
        // timezone within +/-12 hours of UTC.
        const noonPeriodEnd = dayjs.utc(period.periodEnd).hour(12).toDate();
        const noonPeriodStart = dayjs.utc(period.periodStart).hour(12).toDate();

        const event: SpendingTrackerEvent = {
          id: `ST-${category.id}-${formatDate(noonPeriodEnd)}`,
          type: EventType.spendingTracker,
          date: noonPeriodEnd,
          accountId: category.accountId,
          priority: 2.5,
          categoryId: category.id,
          categoryName: category.name,
          periodStart: noonPeriodStart,
          periodEnd: noonPeriodEnd,
          firstSpendingTracker: !isVirtual && isFirstReal,
          virtual: isVirtual,
        };

        this.addEvent(event);
        if (!isVirtual) {
          isFirstReal = false;
        }
      }
    }
    if (this.enableLogging) {
      console.log('  Finished adding spending tracker events', Date.now() - this.calculationBegin, 'ms');
    }
  }

  /**************************************************
   * GENERATE EVENTS
   **************************************************/

  private generateBillEvents(account: Account, bill: Bill, endDate: Date): void {
    // Don't generate events for bills that start after the end date
    if (!bill.startDate || bill.startDate > endDate) return;

    let currentDate = bill.startDate;
    let eventCount = 0;

    // Calculate bill occurrences up to end date
    while (currentDate <= endDate && (!bill.endDate || currentDate <= bill.endDate)) {
      // Skip bill events before portfolio cutoff date
      if (this.cutoffDates?.has(account.id)) {
        const cutoffDate = this.cutoffDates.get(account.id);
        if (cutoffDate && currentDate <= new Date(cutoffDate + 'T00:00:00Z')) {
          // Calculate next occurrence
          currentDate = nextDate(currentDate, bill.periods, bill.everyN);
          currentDate = bill.checkAnnualDates(currentDate);
          eventCount++;
          continue;
        }
      }

      // Calculate the amount of the bill
      const amount = this.calculateBillAmount(bill, currentDate);
      const event: BillEvent = {
        id: `bill_${account.id}_${bill.id}_${eventCount}`,
        type: EventType.bill,
        date: new Date(currentDate),
        accountId: account.id,
        priority: 2,
        originalBill: bill,
        amount,
        firstBill: eventCount === 0,
      };

      this.addEvent(event);

      // Calculate next occurrence
      currentDate = nextDate(currentDate, bill.periods, bill.everyN);
      currentDate = bill.checkAnnualDates(currentDate);
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many bill events generated for bill ${bill.id}`);
      }
    }
  }

  private generateInterestEvents(account: Account, interests: Interest[], endDate: Date): void {
    let nextApplicableDate = endDate;
    for (let i = 0; i < account.interests.length; i++) {
      if (interests[i + 1]) {
        nextApplicableDate = interests[i + 1].applicableDate;
      } else {
        nextApplicableDate = endDate;
      }
      const interest = interests[i];
      let currentDate = interest.applicableDate;
      let eventCount = 0;
      // For all but the last interest config, use strict less-than to avoid boundary overlap
      // The last config uses <= since there's no next config to hand off to
      const isLastConfig = i === account.interests.length - 1;
      while (isLastConfig ? currentDate <= nextApplicableDate : currentDate < nextApplicableDate) {
        // Skip interest events before portfolio cutoff date
        if (this.cutoffDates?.has(account.id)) {
          const cutoffDate = this.cutoffDates.get(account.id);
          if (cutoffDate && currentDate <= new Date(cutoffDate + 'T00:00:00Z')) {
            // Calculate next interest application date
            currentDate = nextDate(currentDate, interest.compounded, 1);
            eventCount++;
            continue;
          }
        }

        // Calculate the rate of the interest
        const rate = interest.apr;
        const event: InterestEvent = {
          id: `interest_${account.id}_${interest.id}_${eventCount}`,
          type: EventType.interest,
          date: new Date(currentDate),
          accountId: account.id,
          priority: 0,
          originalInterest: interest,
          rate,
          firstInterest: eventCount === 0,
        };

        this.addEvent(event);

        // Calculate next interest application date
        currentDate = nextDate(currentDate, interest.compounded, 1);
        eventCount++;

        // Safety check to prevent infinite loops
        if (eventCount > 10000) {
          throw new Error(`Too many interest events generated for interest ${interest.id}`);
        }
      }
    }
  }

  private generateTransferBillEvents(bill: Bill, endDate: Date): void {
    // Don't generate events for bills that start after the end date
    if (!bill.startDate || bill.startDate > endDate) return;

    let currentDate = bill.startDate;
    let eventCount = 0;

    if (!bill.fro || !bill.to) {
      return;
    }

    const fromAccount = this.accountManager.getAccountByName(bill.fro);
    const toAccount = this.accountManager.getAccountByName(bill.to);

    if (!fromAccount && !toAccount) {
      return;
    }

    // Handle cases where only one account is present (partial transfer processing)
    let shouldProcessTransfer = false;
    let accountsToProcess: { account: Account; isSource: boolean }[] = [];

    if (fromAccount) {
      accountsToProcess.push({ account: fromAccount, isSource: true });
      shouldProcessTransfer = true;
    }

    if (toAccount) {
      accountsToProcess.push({ account: toAccount, isSource: false });
      shouldProcessTransfer = true;
    }

    if (!shouldProcessTransfer) {
      return;
    }

    // Calculate bill occurrences up to end date
    while (currentDate <= endDate && (!bill.endDate || currentDate <= bill.endDate)) {
      // Skip transfer bill events before portfolio cutoff date (check both accounts)
      let shouldSkip = false;
      if (fromAccount && this.cutoffDates?.has(fromAccount.id)) {
        const cutoffDate = this.cutoffDates.get(fromAccount.id);
        if (cutoffDate && currentDate <= new Date(cutoffDate + 'T00:00:00Z')) {
          shouldSkip = true;
        }
      }
      if (!shouldSkip && toAccount && this.cutoffDates?.has(toAccount.id)) {
        const cutoffDate = this.cutoffDates.get(toAccount.id);
        if (cutoffDate && currentDate <= new Date(cutoffDate + 'T00:00:00Z')) {
          shouldSkip = true;
        }
      }

      if (!shouldSkip) {
        // Calculate the amount of the bill
        const amount = this.calculateBillAmount(bill, currentDate);
        const event: BillTransferEvent = {
          id: `bill_from_${fromAccount?.id}_to_${toAccount?.id}_${bill.id}_${eventCount}`,
          type: EventType.billTransfer,
          date: new Date(currentDate),
          accountId: fromAccount?.id || toAccount?.id || '',
          priority: 2,
          originalBill: bill,
          amount,
          fromAccountId: fromAccount?.id || '',
          toAccountId: toAccount?.id || '',
          firstBill: isSame(currentDate, bill.startDate),
        };

        this.addEvent(event);
      }

      // Calculate next occurrence
      currentDate = nextDate(currentDate, bill.periods, bill.everyN);
      currentDate = bill.checkAnnualDates(currentDate);
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many bill events generated for bill ${bill.id}`);
      }
    }
  }

  private generateSocialSecurityEvents(socialSecurity: SocialSecurity, endDate: Date): void {
    if (!socialSecurity.startDate || socialSecurity.startDate > endDate) {
      return;
    }

    // Find the account to pay to
    const payToAccount = this.accountManager.getAccountByName(socialSecurity.payToAccount);
    if (!payToAccount) {
      this.log('ss-payout-account-not-found', { payToAccount: socialSecurity.payToAccount });
      return;
    }

    // Add events monthly starting from the start date
    let currentDate = socialSecurity.startDate;
    let eventCount = 0;
    while (currentDate <= endDate) {
      // Calculate the age at the current date
      const ownerAge = dayjs.utc(currentDate).diff(socialSecurity.birthDate, 'year');

      // Create the Social Security event
      const event: SocialSecurityEvent = {
        id: `social_security_${socialSecurity.name}_${eventCount}`,
        type: EventType.socialSecurity,
        date: new Date(currentDate),
        accountId: payToAccount.id,
        socialSecurity,
        ownerAge: ownerAge,
        priority: 2,
        firstPayment: eventCount === 0, // Mark the first payment
      };

      this.addEvent(event);

      // Move to the next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many Social Security events generated for ${socialSecurity.name}`);
      }
    }
  }

  private generatePensionEvents(pension: Pension, endDate: Date): void {
    if (!pension.startDate || pension.startDate > endDate) {
      return;
    }

    // Find the account to pay to
    const payToAccount = this.accountManager.getAccountByName(pension.payToAccount);
    if (!payToAccount) {
      this.log('pension-payout-account-not-found', { payToAccount: pension.payToAccount });
      return;
    }

    // Check if pension is vested (yearsWorked meets minimum requirement)
    const minVestingYears = Math.min(
      ...pension.unreducedRequirements.map(r => r.yearsWorked),
      ...pension.reducedRequirements.map(r => r.yearsWorked)
    );
    if (pension.yearsWorked < minVestingYears) {
      return; // Not vested, don't generate any pension events
    }

    // Add events monthly starting from the start date
    let currentDate = pension.startDate;
    let eventCount = 0;
    while (currentDate <= endDate) {
      // Calculate the age at the current date
      const ownerAge = dayjs.utc(currentDate).diff(pension.birthDate, 'year');

      // Create the Pension event
      const event: PensionEvent = {
        id: `pension_${pension.name}_${eventCount}`,
        type: EventType.pension,
        date: new Date(currentDate),
        accountId: payToAccount.id,
        pension,
        ownerAge: ownerAge,
        priority: 2,
        firstPayment: eventCount === 0, // Mark the first payment
      };

      this.addEvent(event);

      // Move to the next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;

      // Safety check to prevent infinite loops
      if (eventCount > 10000) {
        throw new Error(`Too many Pension events generated for ${pension.name}`);
      }
    }
  }

  private generateRmdEvents(account: Account, startDate: Date, endDate: Date): void {
    // Transfer RMDs on January 1st (uses prior year-end balance per IRS rules)
    const RMD_MONTH = 1;
    const RMD_DAY = 1;

    // Check if the account has RMD enabled
    if (!account.usesRMD || !account.rmdAccount || !account.accountOwnerDOB) {
      return;
    }

    // Add RMD event for each year in the range
    // Note: RMD for a given year uses the balance from the END of the previous year.
    // By firing on Jan 1, the balance at that moment IS the prior year-end balance.
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();
    for (let year = startYear; year <= endYear; year++) {
      const rmdDate = new Date(Date.UTC(year, RMD_MONTH - 1, RMD_DAY));
      if (isAfterOrSame(rmdDate, startDate) && isBeforeOrSame(rmdDate, endDate)) {
        const event: RMDEvent = {
          id: `rmd_${account.id}_${year}`,
          type: EventType.rmd,
          date: rmdDate,
          accountId: account.id,
          ownerAge: dayjs.utc(rmdDate).diff(account.accountOwnerDOB, 'year'),
          fromAccountId: account.id,
          toAccountId: this.accountManager.getAccountByName(account.rmdAccount)?.id || '',
          priority: 0.5,
        };
        this.addEvent(event);
      }
    }
  }

  private generateTaxEvents(account: Account, startDate: Date, endDate: Date): void {
    // Pay taxes on March 1st
    const TAX_MONTH = 3;
    const TAX_DAY = 1;

    // Might pay taxes if the account performs pulls or is an interest-paying account
    const paysTaxes = account.performsPulls || this.accountManager.getInterestPayAccountNames().has(account.name);
    if (!paysTaxes) {
      return;
    }

    // Add tax event for each year in the range
    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();

    for (let year = startYear; year <= endYear; year++) {
      const taxDate = new Date(Date.UTC(year, TAX_MONTH - 1, TAX_DAY));
      if (isAfterOrSame(taxDate, startDate) && isBeforeOrSame(taxDate, endDate)) {
        const event: TaxEvent = {
          id: `tax_${account.id}_${year}`,
          type: EventType.tax,
          date: taxDate,
          accountId: account.id,
          priority: 3,
        };
        this.addEvent(event);
      }
    }
  }

  private generateRothConversionEvents(
    startDate: Date,
    endDate: Date,
    calculationOptions: CalculationOptions,
  ): void {
    // Generate Roth conversion events on December 31 for each year in range
    // Priority 3.5: after RMD (0.5), tax (3), but as a year-end processing event
    // TODO #20: Roth conversion events for bracket-filling strategy
    const CONVERSION_MONTH = 12;
    const CONVERSION_DAY = 31;

    const startYear = startDate.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();

    for (let year = startYear; year <= endYear; year++) {
      const conversionDate = new Date(Date.UTC(year, CONVERSION_MONTH - 1, CONVERSION_DAY));
      if (isAfterOrSame(conversionDate, startDate) && isBeforeOrSame(conversionDate, endDate)) {
        const event: RothConversionEvent = {
          id: `roth_conversion_${year}`,
          type: EventType.rothConversion,
          date: conversionDate,
          accountId: '', // No specific account, processed globally
          priority: 3.5,
          year,
        };
        this.addEvent(event);
      }
    }
  }

  private generateMedicarePremiumEvents(
    personName: string,
    age65Date: Date,
    endDate: Date,
    accountId: string,
    birthDate: Date,
  ): void {
    if (age65Date > endDate) {
      return; // Never turns 65 in this range
    }

    let currentDate = age65Date;
    let eventCount = 0;

    while (currentDate <= endDate) {
      const age = dayjs.utc(currentDate).diff(birthDate, 'year');
      const year = currentDate.getUTCFullYear();

      const event: MedicarePremiumEvent = {
        id: `medicare_premium_${personName}_${eventCount}`,
        type: EventType.medicarePremium,
        date: new Date(currentDate),
        accountId: accountId,
        priority: 2.1, // Slightly after regular bills
        personName: personName,
        ownerAge: age,
        year: year,
      };

      this.addEvent(event);

      // Move to next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;

      // Safety check
      if (eventCount > 10000) {
        throw new Error(`Too many Medicare premium events generated for ${personName}`);
      }
    }
  }

  private generateMedicareHospitalEvents(
    personName: string,
    age65Date: Date,
    endDate: Date,
    accountId: string,
    birthDate: Date,
  ): void {
    if (age65Date > endDate) {
      return; // Never turns 65 in this range
    }

    // Generate one hospital check event on January 1 of each year
    const startYear = age65Date.getUTCFullYear();
    const endYear = endDate.getUTCFullYear();

    for (let year = startYear; year <= endYear; year++) {
      const hospitalDate = new Date(Date.UTC(year, 0, 1)); // January 1
      if (isAfterOrSame(hospitalDate, age65Date) && isBeforeOrSame(hospitalDate, endDate)) {
        const age = dayjs.utc(hospitalDate).diff(birthDate, 'year');

        const event: MedicareHospitalEvent = {
          id: `medicare_hospital_${personName}_${year}`,
          type: EventType.medicareHospital,
          date: hospitalDate,
          accountId: accountId,
          priority: 2.2, // Slightly after premiums
          personName: personName,
          ownerAge: age,
          year: year,
        };

        this.addEvent(event);
      }
    }
  }

  private generateLTCCheckEvents(
    personName: string,
    gender: string,
    age60Date: Date,
    endDate: Date,
    accountId: string,
    birthDate: Date,
    startDate: Date,
    monthIndex: number,
  ): void {
    // LTC events only relevant if person reaches age 60 within the calculation range
    if (age60Date > endDate) {
      return; // Never reaches age 60 in this range
    }

    // Only start generating events from startDate onward
    let currentDate = age60Date < startDate ? startDate : age60Date;
    let monthCounter = monthIndex;

    while (currentDate <= endDate) {
      const age = dayjs.utc(currentDate).diff(birthDate, 'year');
      const year = currentDate.getUTCFullYear();

      const event: LTCCheckEvent = {
        id: `ltc_check_${personName}_${monthCounter}`,
        type: EventType.ltcCheck,
        date: new Date(currentDate),
        accountId: accountId,
        priority: 2.3, // After Medicare (2.1-2.2), before tax (3)
        personName: personName,
        gender: gender,
        ownerAge: age,
        year: year,
        birthDate: birthDate,
        monthIndex: monthCounter,
      };

      this.addEvent(event);

      // Move to next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      monthCounter++;

      // Safety check
      if (monthCounter > 100000) {
        throw new Error(`Too many LTC check events generated for ${personName}`);
      }
    }
  }

  private generateAcaPremiumEvents(
    personName: string,
    retireDate: Date,
    laterAge65Date: Date,
    accountId: string,
    birthDate1: Date,
    birthDate2: Date,
    startDate: Date,
    endDate: Date,
  ): void {
    // ACA events run from retirement to the later age-65 date (when both are 65+)
    if (retireDate > endDate || laterAge65Date < startDate) {
      return; // No overlap with calculation period
    }

    // Determine COBRA period: first 18 months after retirement
    const cobraEndDate = dayjs.utc(retireDate).add(18, 'months').toDate();

    let currentDate = dayjs.utc(retireDate).startOf('month').toDate();
    let eventCount = 0;

    while (currentDate <= laterAge65Date && currentDate <= endDate) {
      // Only generate events within the calculation period
      if (currentDate >= startDate) {
        const year = currentDate.getUTCFullYear();
        const isCobraPeriod = currentDate < cobraEndDate;

        const event: AcaPremiumEvent = {
          id: `aca_premium_${personName}_${eventCount}`,
          type: EventType.acaPremium,
          date: new Date(currentDate),
          accountId: accountId,
          priority: 2.1, // Same as Medicare premiums
          personName: personName,
          ownerAge: dayjs.utc(currentDate).diff(birthDate1, 'year'),
          year: year,
          retirementDate: retireDate,
          isCobraPeriod: isCobraPeriod,
          birthDate1: birthDate1,
          birthDate2: birthDate2,
        };

        this.addEvent(event);
      }

      // Move to next month
      currentDate = dayjs.utc(currentDate).add(1, 'month').toDate();
      eventCount++;

      // Safety check
      if (eventCount > 10000) {
        throw new Error(`Too many ACA premium events generated for ${personName}`);
      }
    }
  }

  /**************************************************
   * HELPERS
   **************************************************/

  private yearIncreases(startDate: Date, endDate: Date, increaseDate: { day: number; month: number }): number {
    let count = 0;

    // Start from the first possible increase date after startDate
    const startYear = startDate.getUTCFullYear();

    // End at the last possible increase date before endDate
    const endYear = endDate.getUTCFullYear();

    // Count the number of years between startDate and endDate that have the increase date
    for (let year = startYear; year <= endYear; year++) {
      const milestone = new Date(Date.UTC(year, increaseDate.month, increaseDate.day));
      if (isAfterOrSame(milestone, startDate) && isBeforeOrSame(milestone, endDate)) {
        count++;
      }
    }
    return count;
  }

  private calculateBillAmount(bill: Bill, currentDate: Date): number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}' {
    // If the amount is a special value, return it
    if (
      bill.amount === '{HALF}' ||
      bill.amount === '-{HALF}' ||
      bill.amount === '{FULL}' ||
      bill.amount === '-{FULL}'
    ) {
      return bill.amount;
    }

    let amount = bill.amount;

    // Apply ceilingMultiple if configured
    if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
      amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
    }

    // Apply inflation if configured
    if (bill.increaseBy) {
      const yearsDiff = this.yearIncreases(bill.startDate, currentDate, bill.increaseByDate);
      for (let i = 0; i < yearsDiff; i++) {
        amount *= 1 + bill.increaseBy;
        // Apply ceilingMultiple if configured
        if (bill.ceilingMultiple && bill.ceilingMultiple > 0) {
          amount = Math.ceil(amount / bill.ceilingMultiple) * bill.ceilingMultiple;
        }
      }
    }

    return amount;
  }

  private calculateBillAmountMonteCarlo(
    bill: Bill,
    currentDate: Date,
    sampleType: string,
  ): number | '{HALF}' | '{FULL}' | '-{HALF}' | '-{FULL}' {
    if (!this.monteCarloConfig?.enabled || !this.monteCarloConfig?.handler) {
      throw new Error('Monte Carlo configuration not enabled');
    }

    // If the amount is a special value, return it
    if (
      bill.amount === '{HALF}' ||
      bill.amount === '-{HALF}' ||
      bill.amount === '{FULL}' ||
      bill.amount === '-{FULL}'
    ) {
      return bill.amount;
    }

    let amount = bill.amount;

    // Apply inflation by increasing the amount by the monte carlo sample every year
    // We don't handle ceilingMultiple with monte carlo, so we'll just return the amount
    const yearsDiff = this.yearIncreases(bill.startDate, currentDate, bill.increaseByDate);
    const samples: number[] = [];
    for (let i = 0; i < yearsDiff; i++) {
      const increaseDate = new Date(Date.UTC(
        bill.startDate.getUTCFullYear() + i,
        bill.increaseByDate.month,
        bill.increaseByDate.day,
      ));
      const sample = this.monteCarloConfig?.handler?.getSample(sampleType, increaseDate);
      if (sample === undefined || sample === null) {
        throw new Error(`No sample found for ${sampleType} on ${formatDate(currentDate)}`);
      }
      samples.push(sample);
      amount *= 1 + sample;
    }

    return amount;
  }

  private addEvent(event: TimelineEvent): void {
    this.events.push(event);
    this.eventIndex.set(event.id, event);
  }

  private sortEvents(): void {
    this.events.sort((a, b) => {
      const dateDiff = a.date.getTime() - b.date.getTime();
      if (dateDiff !== 0) return dateDiff;

      // Same date - sort by priority
      return a.priority - b.priority;
    });

    // Re-index after sorting
    this.rebuildIndices();
  }

  private rebuildIndices(): void {
    this.eventIndex.clear();

    for (const event of this.events) {
      this.eventIndex.set(event.id, event);
    }
  }

  /**
   * Creates calculation segments for optimized processing
   * Takes advantage of the fact that events are already sorted by date
   */
  private createSegments(startDate: Date, endDate: Date): void {
    const segmentSize = 'month'; // Create monthly segments
    let currentStart = dayjs.utc(startDate).startOf(segmentSize).toDate();
    let segmentCount = 0;
    let eventIndex = 0; // Track our position in the sorted events array

    while (currentStart <= endDate) {
      const currentEnd = dayjs.utc(currentStart).endOf(segmentSize).toDate();
      const actualEnd = currentEnd > endDate ? endDate : currentEnd;

      const segmentEvents: TimelineEvent[] = [];
      const affectedAccountIds = new Set<string>();

      // Since events are sorted, we can iterate from where we left off
      while (eventIndex < this.events.length) {
        const event = this.events[eventIndex];

        // If event is past the current segment, stop looking
        if (event.date > actualEnd) {
          break;
        }

        // If event is within the current segment, add it
        if (event.date >= currentStart && event.date <= actualEnd) {
          segmentEvents.push(event);

          // Track affected accounts
          if (event.accountId) {
            affectedAccountIds.add(event.accountId);
          }
          // Add transfer-specific account IDs
          if (event.type === EventType.activityTransfer || event.type === EventType.billTransfer) {
            const transferEvent = event as unknown as TransferEvent;
            if (transferEvent.fromAccountId) affectedAccountIds.add(transferEvent.fromAccountId);
            if (transferEvent.toAccountId) affectedAccountIds.add(transferEvent.toAccountId);
          }
        }

        // Move to next event only if it's within or before the current segment
        if (event.date <= actualEnd) {
          eventIndex++;
        } else {
          break;
        }
      }

      const segment: Segment = {
        id: `segment_${segmentCount}`,
        startDate: new Date(currentStart),
        endDate: new Date(actualEnd),
        events: segmentEvents,
        affectedAccountIds,
        cached: false,
        cacheKey: this.generateSegmentCacheKey(segmentEvents),
      };

      this.segments.push(segment);
      currentStart = dayjs.utc(currentStart).add(1, segmentSize).toDate();
      segmentCount++;
    }

  }

  /**
   * Generates a cache key for a segment using a hash to prevent long filenames
   */
  private generateSegmentCacheKey(events: TimelineEvent[]): string {
    if (events.length === 0) {
      return 'empty';
    }

    // Create a compact representation for hashing
    const eventSummary = events.map((e) => `${e.type}_${e.date.getTime()}_${e.accountId || ''}`).join('|');

    // Generate a short hash to prevent filesystem length issues
    const hash = crypto.createHash('sha256').update(eventSummary).digest('hex').substring(0, 16); // Use first 16 characters for reasonable uniqueness

    // Include event count and date range for debugging
    const startDate = Math.min(...events.map((e) => e.date.getTime()));
    const endDate = Math.max(...events.map((e) => e.date.getTime()));

    return `${events.length}evt_${startDate}_${endDate}_${hash}`;
  }

  getSegments(): Segment[] {
    return [...this.segments];
  }
}
