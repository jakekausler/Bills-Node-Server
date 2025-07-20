/**
 * Dependency tracking system for optimized calculation ordering
 * 
 * This module manages dependencies between accounts, events, and calculations
 * to enable parallel processing and minimize recalculation when data changes.
 */

import { DependencyNode, TimelineEvent, EventType } from './types';
import { Account } from '../../data/account/account';

/**
 * Dependency graph manager
 */
export class DependencyGraph {
  private nodes: Map<string, DependencyNode> = new Map();
  private processedNodes: Set<string> = new Set();

  /**
   * Adds a node to the dependency graph
   */
  addNode(id: string, type: 'account' | 'event' | 'segment', priority: number = 0): DependencyNode {
    const node: DependencyNode = {
      id,
      type,
      dependencies: new Set(),
      dependents: new Set(),
      priority,
      processed: false
    };

    this.nodes.set(id, node);
    return node;
  }

  /**
   * Adds a dependency relationship
   */
  addDependency(dependentId: string, dependencyId: string): void {
    const dependent = this.nodes.get(dependentId);
    const dependency = this.nodes.get(dependencyId);

    if (!dependent || !dependency) {
      throw new Error(`Node not found: ${dependentId} or ${dependencyId}`);
    }

    dependent.dependencies.add(dependencyId);
    dependency.dependents.add(dependentId);
  }

  /**
   * Removes a dependency relationship
   */
  removeDependency(dependentId: string, dependencyId: string): void {
    const dependent = this.nodes.get(dependentId);
    const dependency = this.nodes.get(dependencyId);

    if (dependent) {
      dependent.dependencies.delete(dependencyId);
    }

    if (dependency) {
      dependency.dependents.delete(dependentId);
    }
  }

  /**
   * Gets a node by ID
   */
  getNode(id: string): DependencyNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Gets all nodes of a specific type
   */
  getNodesByType(type: 'account' | 'event' | 'segment'): DependencyNode[] {
    return Array.from(this.nodes.values()).filter(node => node.type === type);
  }

  /**
   * Gets nodes that are ready to be processed (all dependencies satisfied)
   */
  getReadyNodes(): DependencyNode[] {
    const ready: DependencyNode[] = [];

    for (const node of this.nodes.values()) {
      if (!node.processed && this.isNodeReady(node)) {
        ready.push(node);
      }
    }

    // Sort by priority (lower number = higher priority)
    ready.sort((a, b) => a.priority - b.priority);

    return ready;
  }

  /**
   * Checks if a node is ready to be processed
   */
  private isNodeReady(node: DependencyNode): boolean {
    for (const depId of node.dependencies) {
      const depNode = this.nodes.get(depId);
      if (!depNode || !depNode.processed) {
        return false;
      }
    }
    return true;
  }

  /**
   * Marks a node as processed
   */
  markProcessed(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (node) {
      node.processed = true;
      this.processedNodes.add(nodeId);
    }
  }

  /**
   * Resets all processing state
   */
  reset(): void {
    for (const node of this.nodes.values()) {
      node.processed = false;
    }
    this.processedNodes.clear();
  }

  /**
   * Gets the processing order for all nodes
   */
  getProcessingOrder(): string[] {
    this.reset();
    const order: string[] = [];

    while (this.processedNodes.size < this.nodes.size) {
      const readyNodes = this.getReadyNodes();

      if (readyNodes.length === 0) {
        // Check for circular dependencies
        const unprocessed = Array.from(this.nodes.keys())
          .filter(id => !this.processedNodes.has(id));

        if (unprocessed.length > 0) {
          throw new Error(`Circular dependency detected involving nodes: ${unprocessed.join(', ')}`);
        }
        break;
      }

      // Process all ready nodes (they can be processed in parallel)
      for (const node of readyNodes) {
        order.push(node.id);
        this.markProcessed(node.id);
      }
    }

    return order;
  }

  /**
   * Gets nodes that can be processed in parallel at each step
   */
  getParallelProcessingBatches(): string[][] {
    this.reset();
    const batches: string[][] = [];

    while (this.processedNodes.size < this.nodes.size) {
      const readyNodes = this.getReadyNodes();

      if (readyNodes.length === 0) {
        const unprocessed = Array.from(this.nodes.keys())
          .filter(id => !this.processedNodes.has(id));

        if (unprocessed.length > 0) {
          throw new Error(`Circular dependency detected involving nodes: ${unprocessed.join(', ')}`);
        }
        break;
      }

      const batch = readyNodes.map(node => node.id);
      batches.push(batch);

      // Mark all nodes in this batch as processed
      for (const nodeId of batch) {
        this.markProcessed(nodeId);
      }
    }

    return batches;
  }

  /**
   * Finds all nodes that depend on a given node (directly or indirectly)
   */
  findAllDependents(nodeId: string): Set<string> {
    const allDependents = new Set<string>();
    const toProcess = [nodeId];
    const visited = new Set<string>();

    while (toProcess.length > 0) {
      const currentId = toProcess.pop()!;
      if (visited.has(currentId)) continue;

      visited.add(currentId);
      const node = this.nodes.get(currentId);

      if (node) {
        for (const dependentId of node.dependents) {
          allDependents.add(dependentId);
          toProcess.push(dependentId);
        }
      }
    }

    return allDependents;
  }

  /**
   * Finds all nodes that a given node depends on (directly or indirectly)
   */
  findAllDependencies(nodeId: string): Set<string> {
    const allDependencies = new Set<string>();
    const toProcess = [nodeId];
    const visited = new Set<string>();

    while (toProcess.length > 0) {
      const currentId = toProcess.pop()!;
      if (visited.has(currentId)) continue;

      visited.add(currentId);
      const node = this.nodes.get(currentId);

      if (node) {
        for (const dependencyId of node.dependencies) {
          allDependencies.add(dependencyId);
          toProcess.push(dependencyId);
        }
      }
    }

    return allDependencies;
  }

  /**
   * Validates the dependency graph for cycles
   */
  validateNoCycles(): { valid: boolean; cycles: string[][] } {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const detectCycle = (nodeId: string, path: string[]): boolean => {
      if (recursionStack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart).concat([nodeId]));
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      const node = this.nodes.get(nodeId);
      if (node) {
        for (const depId of node.dependencies) {
          if (detectCycle(depId, path)) {
            return true;
          }
        }
      }

      recursionStack.delete(nodeId);
      path.pop();
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        detectCycle(nodeId, []);
      }
    }

    return {
      valid: cycles.length === 0,
      cycles
    };
  }

  /**
   * Gets statistics about the dependency graph
   */
  getStats(): {
    totalNodes: number;
    nodesByType: Record<string, number>;
    totalDependencies: number;
    maxDependencyDepth: number;
    parallelizationFactor: number;
  } {
    const nodesByType: Record<string, number> = {};
    let totalDependencies = 0;

    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] || 0) + 1;
      totalDependencies += node.dependencies.size;
    }

    const maxDepth = this.calculateMaxDependencyDepth();
    const batches = this.getParallelProcessingBatches();
    const avgBatchSize = batches.length > 0 ?
      batches.reduce((sum, batch) => sum + batch.length, 0) / batches.length : 0;

    return {
      totalNodes: this.nodes.size,
      nodesByType,
      totalDependencies,
      maxDependencyDepth: maxDepth,
      parallelizationFactor: avgBatchSize
    };
  }

  /**
   * Calculates the maximum dependency depth in the graph
   */
  private calculateMaxDependencyDepth(): number {
    let maxDepth = 0;
    const visited = new Set<string>();

    const calculateDepth = (nodeId: string, currentDepth: number): number => {
      if (visited.has(nodeId)) {
        return currentDepth;
      }

      visited.add(nodeId);
      const node = this.nodes.get(nodeId);

      if (!node || node.dependencies.size === 0) {
        return currentDepth;
      }

      let maxChildDepth = currentDepth;
      for (const depId of node.dependencies) {
        const childDepth = calculateDepth(depId, currentDepth + 1);
        maxChildDepth = Math.max(maxChildDepth, childDepth);
      }

      return maxChildDepth;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        const depth = calculateDepth(nodeId, 0);
        maxDepth = Math.max(maxDepth, depth);
      }
    }

    return maxDepth;
  }

  /**
   * Removes a node and all its relationships
   */
  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Remove this node from all dependents' dependency lists
    for (const dependentId of node.dependents) {
      const dependent = this.nodes.get(dependentId);
      if (dependent) {
        dependent.dependencies.delete(nodeId);
      }
    }

    // Remove this node from all dependencies' dependent lists
    for (const dependencyId of node.dependencies) {
      const dependency = this.nodes.get(dependencyId);
      if (dependency) {
        dependency.dependents.delete(nodeId);
      }
    }

    // Remove the node itself
    this.nodes.delete(nodeId);
    this.processedNodes.delete(nodeId);
  }

  /**
   * Clears all nodes and relationships
   */
  clear(): void {
    this.nodes.clear();
    this.processedNodes.clear();
  }
}

/**
 * Builds a dependency graph from timeline events and accounts
 */
export function buildDependencyGraph(
  events: TimelineEvent[],
  accounts: Account[]
): DependencyGraph {
  const graph = new DependencyGraph();

  // Add account nodes
  for (const account of accounts) {
    graph.addNode(account.id, 'account', 0);
  }

  // Add event nodes and their dependencies
  for (const event of events) {
    graph.addNode(event.id, 'event', getEventPriority(event));

    // Event depends on its primary account
    if (event.accountId) {
      graph.addDependency(event.id, event.accountId);
    }

    // Add explicit dependencies
    for (const depId of event.dependencies) {
      graph.addDependency(event.id, depId);
    }

    // Add type-specific dependencies
    addTypeSpecificDependencies(graph, event, accounts);
  }

  return graph;
}

/**
 * Gets the processing priority for an event type
 */
function getEventPriority(event: TimelineEvent): number {
  switch (event.type) {
    case EventType.activity:
      return 1; // Highest priority
    case EventType.bill:
      return 2;
    case EventType.interest:
      return 4;
    case EventType.transfer:
      return 3;
    case EventType.pension:
      return 5;
    case EventType.socialSecurity:
      return 6;
    case EventType.tax:
      return 7;
    case EventType.rmd:
      return 8;
    case EventType.pushPullCheck:
      return 10; // Lowest priority - process last
    default:
      return 5;
  }
}

/**
 * Adds type-specific dependencies for events
 */
function addTypeSpecificDependencies(
  graph: DependencyGraph,
  event: TimelineEvent,
  accounts: Account[]
): void {
  switch (event.type) {
    case EventType.transfer:
      // Transfer events depend on both source and destination accounts
      const transferEvent = event as any; // Type assertion for transfer event
      if (transferEvent.fromAccountId && transferEvent.toAccountId) {
        graph.addDependency(event.id, transferEvent.fromAccountId);
        graph.addDependency(event.id, transferEvent.toAccountId);
      }
      break;

    case EventType.pushPullCheck:
      // Push/pull checks depend on all checking accounts and their push/pull targets
      for (const account of accounts) {
        if (account.type === 'Checking' &&
          (account.performsPulls || account.performsPushes)) {
          graph.addDependency(event.id, account.id);

          // Add dependency on push account if it exists
          if (account.pushAccount) {
            const pushAccount = accounts.find(a => a.name === account.pushAccount);
            if (pushAccount) {
              graph.addDependency(event.id, pushAccount.id);
            }
          }
        }
      }
      break;

    case EventType.tax:
      // Tax events depend on all accounts (since they can affect any account)
      for (const account of accounts) {
        graph.addDependency(event.id, account.id);
      }
      break;

    case EventType.rmd:
      // RMD events depend on retirement accounts and their target accounts
      for (const account of accounts) {
        if (account.type === '401k' || account.type === 'IRA' || account.type === 'Roth IRA') {
          graph.addDependency(event.id, account.id);
          // Also depend on the account where RMD is transferred to
          if (account.rmdAccount) {
            const targetAccount = accounts.find(acc => acc.name === account.rmdAccount);
            if (targetAccount) {
              graph.addDependency(event.id, targetAccount.id);
            }
          }
        }
      }
      break;
  }
}

/**
 * Optimizes the dependency graph by removing unnecessary dependencies
 */
export function optimizeDependencyGraph(graph: DependencyGraph): void {
  // Remove transitive dependencies
  // If A depends on B and B depends on C, and A also depends on C,
  // we can remove the A -> C dependency as it's redundant

  const nodes = Array.from(graph.getNodesByType('event'));

  for (const node of nodes) {
    const directDeps = new Set(node.dependencies);
    const indirectDeps = new Set<string>();

    // Find all indirect dependencies
    for (const depId of directDeps) {
      const depNode = graph.getNode(depId);
      if (depNode) {
        for (const indirectDepId of depNode.dependencies) {
          indirectDeps.add(indirectDepId);
        }
      }
    }

    // Remove direct dependencies that are also indirect
    for (const depId of directDeps) {
      if (indirectDeps.has(depId)) {
        graph.removeDependency(node.id, depId);
      }
    }
  }
}

/**
 * Identifies accounts that can be calculated independently
 */
export function findIndependentAccounts(
  graph: DependencyGraph,
  accounts: Account[]
): Account[][] {
  const accountGroups: Account[][] = [];
  const processedAccounts = new Set<string>();

  for (const account of accounts) {
    if (processedAccounts.has(account.id)) continue;

    // Find all accounts that this account depends on or that depend on it
    const relatedAccountIds = new Set<string>();
    relatedAccountIds.add(account.id);

    const addRelatedAccounts = (accountId: string) => {
      const dependencies = graph.findAllDependencies(accountId);
      const dependents = graph.findAllDependents(accountId);

      for (const id of dependencies) {
        if (!relatedAccountIds.has(id)) {
          relatedAccountIds.add(id);
          addRelatedAccounts(id);
        }
      }

      for (const id of dependents) {
        if (!relatedAccountIds.has(id)) {
          relatedAccountIds.add(id);
          addRelatedAccounts(id);
        }
      }
    };

    addRelatedAccounts(account.id);

    // Create a group with all related accounts
    const group = accounts.filter(acc => relatedAccountIds.has(acc.id));
    if (group.length > 0) {
      accountGroups.push(group);

      // Mark all accounts in this group as processed
      for (const acc of group) {
        processedAccounts.add(acc.id);
      }
    }
  }

  return accountGroups;
}