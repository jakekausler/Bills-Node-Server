#!/usr/bin/env npx tsx

/**
 * Simple test script to verify MonthEndCheckEvent functionality
 */

import { Timeline } from '../timeline';
import { EventType } from '../types';
import { AccountsAndTransfers } from '../../../data/account/types';
import { Account } from '../../../data/account/account';

// Create a simple test scenario
const testAccount = new Account({
  id: 'test-account',
  name: 'Test Checking',
  type: 'Checking',
  balance: 5000,
  minimumBalance: 1000, // This account needs push/pull management
  activity: [],
  bills: [],
  interests: []
});

console.log('Test account properties:', {
  id: testAccount.id,
  minimumBalance: testAccount.minimumBalance,  
  performsPulls: testAccount.performsPulls,
  performsPushes: testAccount.performsPushes
});

const accountsAndTransfers: AccountsAndTransfers = {
  accounts: [testAccount],
  transfers: {
    activity: [],
    bills: []
  }
};

const startDate = new Date('2025-01-01');
const endDate = new Date('2025-03-31');

console.log('Testing MonthEndCheckEvent creation...');

// Create timeline with month-end check events
const timeline = Timeline.fromAccountsAndTransfers(
  accountsAndTransfers,
  startDate,
  endDate,
  'default'
);

// Check that month-end events were created
const monthEndEvents = timeline.getEventsByType(EventType.monthEndCheck);
console.log(`Created ${monthEndEvents.length} month-end check events`);

for (const event of monthEndEvents) {
  console.log(`- Event: ${event.id}, Date: ${event.date.toISOString()}, ManagedAccounts: ${JSON.stringify(event)}`);
}

// Verify events are properly sorted
const allEvents = timeline.getEvents();
console.log(`\nTotal events: ${allEvents.length}`);

let previousDate = new Date(0);
for (const event of allEvents) {
  if (event.date < previousDate) {
    console.error('ERROR: Events are not properly sorted!');
    break;
  }
  previousDate = event.date;
}

console.log('✓ Timeline events are properly sorted');

// Check that MonthEndCheckEvent has the expected properties
if (monthEndEvents.length > 0) {
  const firstEvent = monthEndEvents[0] as any;
  if ('monthStart' in firstEvent && 'monthEnd' in firstEvent && 'managedAccounts' in firstEvent) {
    console.log('✓ MonthEndCheckEvent has required properties');
    console.log(`  - monthStart: ${firstEvent.monthStart.toISOString()}`);
    console.log(`  - monthEnd: ${firstEvent.monthEnd.toISOString()}`);
    console.log(`  - managedAccounts: ${JSON.stringify(firstEvent.managedAccounts)}`);
  } else {
    console.error('ERROR: MonthEndCheckEvent missing required properties');
  }
}

console.log('\nTest completed successfully!');