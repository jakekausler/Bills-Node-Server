/**
 * Test suite for dependency graph management in calculate-v2
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DependencyGraph, buildDependencyGraph } from './dependency';
import { TimelineEvent, EventType } from './types';
import { Account } from '../../data/account/account';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('Basic dependency operations', () => {
    it('should add and retrieve dependencies', () => {
      // Add nodes first
      graph.addNode('event1', 'event');
      graph.addNode('event2', 'event');
      graph.addNode('account1', 'account');
      graph.addNode('account2', 'account');

      graph.addDependency('event1', 'account1');
      graph.addDependency('event1', 'account2');
      graph.addDependency('event2', 'account1');

      const node1 = graph.getNode('event1');
      const node2 = graph.getNode('event2');

      expect(node1?.dependencies).toEqual(new Set(['account1', 'account2']));
      expect(node2?.dependencies).toEqual(new Set(['account1']));
    });

    it('should handle non-existent nodes', () => {
      const node = graph.getNode('non-existent');
      expect(node).toBeNull();
    });

    it('should not duplicate dependencies', () => {
      graph.addNode('event1', 'event');
      graph.addNode('account1', 'account');

      graph.addDependency('event1', 'account1');
      graph.addDependency('event1', 'account1'); // Duplicate

      const node = graph.getNode('event1');
      expect(node?.dependencies.size).toBe(1);
      expect(node?.dependencies.has('account1')).toBe(true);
    });
  });

  describe('Dependency chain detection', () => {
    it('should detect circular dependencies', () => {
      graph.addDependency('event1', 'event2');
      graph.addDependency('event2', 'event3');
      graph.addDependency('event3', 'event1'); // Creates cycle

      expect(graph.hasCircularDependencies()).toBe(true);
    });

    it('should not flag valid dependency chains as circular', () => {
      graph.addDependency('event1', 'event2');
      graph.addDependency('event2', 'event3');
      graph.addDependency('event3', 'account1');

      expect(graph.hasCircularDependencies()).toBe(false);
    });
  });

  describe('Topological sorting', () => {
    it('should sort events in dependency order', () => {
      // Event3 depends on Event2, Event2 depends on Event1
      graph.addDependency('event3', 'event2');
      graph.addDependency('event2', 'event1');

      const sorted = graph.topologicalSort(['event1', 'event2', 'event3']);

      expect(sorted.indexOf('event1')).toBeLessThan(sorted.indexOf('event2'));
      expect(sorted.indexOf('event2')).toBeLessThan(sorted.indexOf('event3'));
    });

    it('should handle independent events', () => {
      const events = ['event1', 'event2', 'event3'];
      const sorted = graph.topologicalSort(events);

      expect(sorted).toHaveLength(3);
      expect(sorted).toEqual(expect.arrayContaining(events));
    });

    it('should throw error for circular dependencies', () => {
      graph.addDependency('event1', 'event2');
      graph.addDependency('event2', 'event1');

      expect(() => {
        graph.topologicalSort(['event1', 'event2']);
      }).toThrow('Circular dependency detected');
    });
  });

  describe('Affected events calculation', () => {
    it('should find events affected by account changes', () => {
      graph.addDependency('event1', 'account1');
      graph.addDependency('event2', 'account1');
      graph.addDependency('event2', 'account2');
      graph.addDependency('event3', 'account2');

      const affected = graph.getEventsAffectedByAccounts(['account1']);
      expect(affected).toEqual(new Set(['event1', 'event2']));
    });

    it('should handle multiple account changes', () => {
      graph.addDependency('event1', 'account1');
      graph.addDependency('event2', 'account2');
      graph.addDependency('event3', 'account3');

      const affected = graph.getEventsAffectedByAccounts(['account1', 'account3']);
      expect(affected).toEqual(new Set(['event1', 'event3']));
    });
  });
});

describe('buildDependencyGraph', () => {
  const mockAccount1 = {
    id: 'acc1',
    name: 'Checking',
    type: 'Checking',
  } as Account;

  const mockAccount2 = {
    id: 'acc2',
    name: 'Savings',
    type: 'Savings',
  } as Account;

  const mockAccount3 = {
    id: 'acc3',
    name: 'IRA',
    type: 'IRA',
    rmdAccount: 'Checking',
  } as Account;

  it('should build dependency graph for activity events', () => {
    const events: TimelineEvent[] = [
      {
        id: 'activity_1',
        type: EventType.ACTIVITY,
        date: new Date(),
        accountId: 'acc1',
        priority: 1,
        cacheable: true,
        dependencies: [],
      },
    ];

    const graph = buildDependencyGraph(events, [mockAccount1, mockAccount2]);
    const deps = graph.getDependencies('activity_1');

    expect(deps.has('acc1')).toBe(true);
  });

  it('should build dependency graph for transfer events', () => {
    const transferEvent: any = {
      id: 'transfer_1',
      type: EventType.TRANSFER,
      date: new Date(),
      accountId: 'acc1',
      priority: 1,
      cacheable: true,
      dependencies: [],
      fromAccountId: 'acc1',
      toAccountId: 'acc2',
    };

    const graph = buildDependencyGraph([transferEvent], [mockAccount1, mockAccount2]);
    const deps = graph.getDependencies('transfer_1');

    expect(deps.has('acc1')).toBe(true);
    expect(deps.has('acc2')).toBe(true);
  });

  it('should build dependency graph for RMD events', () => {
    const rmdEvent: TimelineEvent = {
      id: 'rmd_1',
      type: EventType.RMD,
      date: new Date(),
      accountId: 'acc3',
      priority: 1,
      cacheable: true,
      dependencies: [],
    };

    const graph = buildDependencyGraph([rmdEvent], [mockAccount1, mockAccount3]);
    const deps = graph.getDependencies('rmd_1');

    expect(deps.has('acc3')).toBe(true);
    expect(deps.has('acc1')).toBe(true); // RMD target account
  });

  it('should handle push/pull events', () => {
    const pushPullAccount = {
      id: 'acc1',
      name: 'Checking',
      type: 'Checking',
      performsPulls: true,
      performsPushes: true,
    } as Account;

    const pushPullEvent: TimelineEvent = {
      id: 'pushpull_1',
      type: EventType.PUSH_PULL_CHECK,
      date: new Date(),
      accountId: 'acc1',
      priority: 1,
      cacheable: true,
      dependencies: [],
    };

    const graph = buildDependencyGraph([pushPullEvent], [pushPullAccount]);
    const deps = graph.getDependencies('pushpull_1');

    expect(deps.has('acc1')).toBe(true);
  });
});
