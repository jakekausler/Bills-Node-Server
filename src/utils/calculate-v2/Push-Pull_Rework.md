# Push-Pull System Rework Plan

## Overview

The current push-pull implementation in calculate-v2 has accuracy issues due to its approach of predicting future balances at the beginning of each month. This document outlines a comprehensive rework to implement a retroactive push-pull system that processes transactions normally through the month, then applies push/pull decisions retroactively based on actual balance data.

## Current Implementation Problems

### 1. Inaccurate Balance Projections

The current system uses `generateEventBasedProjections` to predict future balances, but this approach:

- Doesn't account for interest calculations that depend on actual daily balances
- Misses transfer restrictions based on account balances
- Ignores cascading effects of balance changes
- Cannot accurately predict variable amounts or conditional transactions

### 2. Inefficient Processing

- The original implementation creates deep copies of all data structures for look-ahead
- The new implementation tries to avoid deep copies but loses accuracy
- Both approaches process the same time period multiple times

### 3. Timing Issues

- Push/pull decisions are made at month start based on predictions
- This leads to unnecessary transfers when predictions don't match reality
- The system cannot adapt to unexpected transactions during the month

## Proposed Solution: Retroactive Push-Pull System

### Core Concept

Instead of predicting the future at month start, we will:

1. Process all events normally through the month
2. At month end, analyze actual min/max balances achieved
3. If violations occurred, retroactively insert push/pull at month start
4. Recalculate only affected events (interests, dependent transfers)

### Algorithm Flow

```
Month Start
    ↓
Process all events normally (no push/pull)
    ↓
Track daily balances for each account
    ↓
Month End
    ↓
Analyze min/max balances for managed accounts
    ↓
If violations found:
    - Calculate required push/pull amounts
    - Insert push/pull activities at month start
    - Mark affected events for recalculation
    ↓
Recalculate affected events:
    - Interest calculations (balance-dependent)
    - Transfers with balance restrictions
    - Subsequent months' push/pull decisions
```

## Implementation Components

### 1. MonthEndAnalyzer

**Purpose**: Track and analyze balance patterns throughout the month

**Key Features**:

- Maintain min/max balance records per account per month
- Identify balance violations against account rules
- Calculate optimal transfer amounts to prevent violations

**Implementation Details**:

```typescript
interface BalanceAnalysis {
  accountId: string;
  month: Date;
  minimumBalance: number;
  minimumBalanceDate: Date;
  maximumBalance: number;
  maximumBalanceDate: Date;
  dailyBalances: Map<string, number>; // date string -> balance
  violations: BalanceViolation[];
}

interface BalanceViolation {
  type: 'minimum' | 'maximum';
  date: Date;
  actualBalance: number;
  requiredBalance: number;
  shortfall: number;
}

class MonthEndAnalyzer {
  analyzeMonth(account: Account, monthStart: Date, monthEnd: Date, balanceTracker: BalanceTracker): BalanceAnalysis;

  determineRequiredTransfers(analysis: BalanceAnalysis, account: Account): RequiredTransfer[];
}
```

### 2. RetroactiveApplicator

**Purpose**: Apply push/pull decisions retroactively at month start

**Key Features**:

- Insert push/pull activities at the correct position in timeline
- Update balance tracker with retroactive changes
- Maintain event ordering and consistency
- Handle multi-account transfer scenarios

**Implementation Details**:

```typescript
interface RequiredTransfer {
  type: 'push' | 'pull';
  fromAccount: Account;
  toAccount: Account;
  amount: number;
  insertDate: Date; // Beginning of month
  reason: string;
}

class RetroactiveApplicator {
  applyTransfers(transfers: RequiredTransfer[], timeline: Timeline, balanceTracker: BalanceTracker): AppliedTransfer[];

  createPushPullActivities(transfer: RequiredTransfer): ConsolidatedActivity[];
}
```

### 3. SelectiveRecalculator

**Purpose**: Efficiently recalculate only events affected by retroactive changes

**Key Features**:

- Identify events that depend on account balances
- Recalculate interest events with new balance history
- Update transfers that may be affected by balance changes
- Propagate changes to subsequent months

**Implementation Details**:

```typescript
interface RecalculationScope {
  affectedAccounts: Set<string>;
  startDate: Date;
  endDate: Date;
  eventTypes: Set<EventType>;
}

class SelectiveRecalculator {
  identifyAffectedEvents(appliedTransfers: AppliedTransfer[], timeline: Timeline): TimelineEvent[];

  recalculateEvents(
    events: TimelineEvent[],
    balanceTracker: BalanceTracker,
    accountsAndTransfers: AccountsAndTransfers,
  ): RecalculationResult;
}
```

### 4. Timeline Modifications

**Changes Required**:

- Replace `PushPullEvent` with `MonthEndCheckEvent`
- Generate month-end events instead of month-start
- Add support for retroactive event insertion

```typescript
export interface MonthEndCheckEvent extends TimelineEvent {
  type: EventType.monthEndCheck;
  monthStart: Date;
  monthEnd: Date;
  managedAccounts: string[]; // Account IDs to check
}
```

### 5. Engine Integration

**Changes to CalculationEngine**:

- Add month-end processing phase
- Implement retroactive application workflow
- Handle recalculation passes

```typescript
// In engine.ts processSegment method
case EventType.monthEndCheck:
  const monthResult = await this.processMonthEnd(
    event as MonthEndCheckEvent,
    segmentResult,
    accountsAndTransfers
  );
  if (monthResult.requiresRecalculation) {
    await this.applyRetroactiveChanges(monthResult);
    await this.recalculateAffectedEvents(monthResult);
  }
  break;
```

## Implementation Steps

### Phase 1: Create Core Components

1. Implement `MonthEndAnalyzer` with balance tracking
2. Create `RetroactiveApplicator` for transfer insertion
3. Build `SelectiveRecalculator` for efficient recalculation

### Phase 2: Update Timeline System

1. Replace `PushPullEvent` with `MonthEndCheckEvent`
2. Modify timeline generation to create month-end events
3. Add support for retroactive event insertion

### Phase 3: Integrate with Engine

1. Update `CalculationEngine` to handle month-end events
2. Implement retroactive application workflow
3. Add recalculation pass management

### Phase 4: Handle Edge Cases

1. Transfer limits and restrictions
2. Tax implications for retirement accounts
3. Multiple account dependencies
4. Cross-month effects

### Phase 5: Testing and Validation

1. Update accuracy comparison tests
2. Verify retroactive calculations match original
3. Performance benchmarking
4. Edge case validation

## Key Considerations

### 1. Event Ordering

- Maintain strict chronological ordering when inserting retroactive events
- Ensure balance consistency throughout the timeline
- Handle same-day event priorities correctly

### 2. Performance Optimization

- Cache month-end analysis results
- Minimize recalculation scope
- Use incremental balance updates
- Avoid unnecessary event regeneration

### 3. Tax Implications

- Track tax events for retirement account withdrawals
- Ensure tax calculations use correct withdrawal amounts
- Handle early withdrawal penalties appropriately

### 4. Multi-Account Scenarios

- Handle push/pull priorities correctly
- Prevent circular transfers
- Respect account minimums during transfers
- Consider available balances in source accounts

## Success Criteria

1. **Accuracy**: Push/pull amounts match original implementation
2. **Performance**: Faster than deep-copy approach
3. **Correctness**: No balance inconsistencies or negative balances
4. **Maintainability**: Clear separation of concerns and testable components

## Testing Strategy

### Unit Tests

- `MonthEndAnalyzer`: Balance tracking and violation detection
- `RetroactiveApplicator`: Event insertion and ordering
- `SelectiveRecalculator`: Affected event identification

### Integration Tests

- Full month processing with push/pull
- Multi-account transfer scenarios
- Tax calculation accuracy
- Cross-month dependencies

### Accuracy Tests

- Compare results with original implementation
- Verify all test scenarios pass
- Check edge cases and boundary conditions

## Migration Notes

1. The new system will coexist with the old during development
2. Use feature flags to switch between implementations
3. Run both systems in parallel for validation
4. Gradual rollout with monitoring

## Future Enhancements

1. **Predictive Warnings**: Alert users to potential violations before month-end
2. **Optimization Suggestions**: Recommend account structure changes
3. **Historical Analysis**: Learn from past patterns to improve decisions
4. **Real-time Adjustments**: Allow mid-month push/pull if needed
