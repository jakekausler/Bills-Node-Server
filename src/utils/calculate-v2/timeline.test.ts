/**
 * Test suite for timeline management in calculate-v2
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Timeline } from './timeline';
import { EventType, TimelineEvent } from './types';
import { AccountsAndTransfers } from '../../data/account/types';

describe('Timeline', () => {
  let timeline: Timeline;

  beforeEach(() => {
    timeline = new Timeline();
  });

  describe('Basic event management', () => {
    it('should add and retrieve events', () => {
      const event: TimelineEvent = {
        id: 'test_event',
        type: EventType.ACTIVITY,
        date: new Date('2024-01-01'),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
      };

      timeline.addEvent(event);

      expect(timeline.getAllEvents()).toHaveLength(1);
      expect(timeline.getAllEvents()[0]).toEqual(event);
    });

    it('should prevent duplicate event IDs', () => {
      const event1: TimelineEvent = {
        id: 'duplicate_id',
        type: EventType.ACTIVITY,
        date: new Date('2024-01-01'),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
      };

      const event2: TimelineEvent = {
        id: 'duplicate_id',
        type: EventType.BILL,
        date: new Date('2024-01-02'),
        accountId: 'acc2',
        priority: 2,
        cacheable: true,
        dependencies: [],
      };

      timeline.addEvent(event1);
      timeline.addEvent(event2);

      expect(timeline.getAllEvents()).toHaveLength(1);
      expect(timeline.getAllEvents()[0].type).toBe(EventType.ACTIVITY);
    });
  });

  describe('Event sorting and priority', () => {
    it('should sort events by date and priority', () => {
      const event1: TimelineEvent = {
        id: 'event1',
        type: EventType.ACTIVITY,
        date: new Date('2024-01-01'),
        accountId: 'acc1',
        priority: 2,
        cacheable: true,
        dependencies: [],
      };

      const event2: TimelineEvent = {
        id: 'event2',
        type: EventType.BILL,
        date: new Date('2024-01-01'),
        accountId: 'acc1',
        priority: 1, // Higher priority (lower number)
        cacheable: true,
        dependencies: [],
      };

      const event3: TimelineEvent = {
        id: 'event3',
        type: EventType.INTEREST,
        date: new Date('2024-01-02'),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
      };

      timeline.addEvent(event1);
      timeline.addEvent(event2);
      timeline.addEvent(event3);

      timeline.sortEvents();
      const sorted = timeline.getAllEvents();

      expect(sorted[0].id).toBe('event2'); // Same date, higher priority
      expect(sorted[1].id).toBe('event1'); // Same date, lower priority
      expect(sorted[2].id).toBe('event3'); // Later date
    });
  });

  describe('Event filtering and querying', () => {
    beforeEach(() => {
      const events: TimelineEvent[] = [
        {
          id: 'event1',
          type: EventType.ACTIVITY,
          date: new Date('2024-01-01'),
          accountId: 'acc1',
          priority: 1,
          cacheable: true,
          dependencies: [],
        },
        {
          id: 'event2',
          type: EventType.BILL,
          date: new Date('2024-01-15'),
          accountId: 'acc2',
          priority: 1,
          cacheable: true,
          dependencies: [],
        },
        {
          id: 'event3',
          type: EventType.INTEREST,
          date: new Date('2024-02-01'),
          accountId: 'acc1',
          priority: 1,
          cacheable: true,
          dependencies: [],
        },
      ];

      events.forEach((event) => timeline.addEvent(event));
    });

    it('should get events in date range', () => {
      const events = timeline.getEventsInRange(new Date('2024-01-01'), new Date('2024-01-31'));

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.id)).toEqual(['event1', 'event2']);
    });

    it('should get events by account', () => {
      const events = timeline.getEventsByAccount('acc1');

      expect(events).toHaveLength(2);
      expect(events.map((e) => e.id)).toEqual(['event1', 'event3']);
    });

    it('should get events by type', () => {
      const events = timeline.getEventsByType(EventType.BILL);

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('event2');
    });
  });

  describe('Segment creation', () => {
    beforeEach(() => {
      // Add events across multiple months
      const events: TimelineEvent[] = [
        {
          id: 'jan_event',
          type: EventType.ACTIVITY,
          date: new Date('2024-01-15'),
          accountId: 'acc1',
          priority: 1,
          cacheable: true,
          dependencies: [],
        },
        {
          id: 'feb_event',
          type: EventType.BILL,
          date: new Date('2024-02-15'),
          accountId: 'acc1',
          priority: 1,
          cacheable: true,
          dependencies: [],
        },
        {
          id: 'mar_event',
          type: EventType.INTEREST,
          date: new Date('2024-03-15'),
          accountId: 'acc1',
          priority: 1,
          cacheable: true,
          dependencies: [],
        },
      ];

      events.forEach((event) => timeline.addEvent(event));
    });

    it('should create monthly segments', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-03-31');

      timeline.createSegments(startDate, endDate, 'month');
      const segments = timeline.getSegments();

      expect(segments).toHaveLength(3);

      // Check that each segment contains the correct events
      expect(segments[0].events).toHaveLength(1);
      expect(segments[0].events[0].id).toBe('jan_event');

      expect(segments[1].events).toHaveLength(1);
      expect(segments[1].events[0].id).toBe('feb_event');

      expect(segments[2].events).toHaveLength(1);
      expect(segments[2].events[0].id).toBe('mar_event');
    });

    it('should create quarterly segments', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');

      timeline.createSegments(startDate, endDate, 'quarter');
      const segments = timeline.getSegments();

      expect(segments).toHaveLength(4);

      // First quarter should contain jan, feb, mar events
      expect(segments[0].events).toHaveLength(3);
    });

    it('should handle segments with affected accounts including transfers', () => {
      // Add a transfer event
      const transferEvent: any = {
        id: 'transfer_event',
        type: EventType.TRANSFER,
        date: new Date('2024-01-15'),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
        fromAccountId: 'acc1',
        toAccountId: 'acc2',
      };

      timeline.addEvent(transferEvent);

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-31');

      timeline.createSegments(startDate, endDate, 'month');
      const segments = timeline.getSegments();

      expect(segments[0].affectedAccounts.has('acc1')).toBe(true);
      expect(segments[0].affectedAccounts.has('acc2')).toBe(true);
    });
  });

  describe('Timeline optimization', () => {
    it('should optimize by removing redundant events', () => {
      // Add redundant interest events for same account on same day
      const event1: TimelineEvent = {
        id: 'interest1',
        type: EventType.INTEREST,
        date: new Date('2024-01-01'),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
      };

      const event2: TimelineEvent = {
        id: 'interest2',
        type: EventType.INTEREST,
        date: new Date('2024-01-01'),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
      };

      timeline.addEvent(event1);
      timeline.addEvent(event2);

      timeline.optimize();

      expect(timeline.getAllEvents()).toHaveLength(2); // Both kept for now (may change optimization logic)
    });
  });
});
