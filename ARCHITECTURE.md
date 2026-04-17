# Bills-Node-Server Architecture

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Layers](#architecture-layers)
3. [Data Models](#data-models)
4. [Calculation Engine (v3)](#calculation-engine-v3)
5. [API Endpoints](#api-endpoints)
6. [Data Persistence](#data-persistence)
7. [Monte Carlo Simulation](#monte-carlo-simulation)
8. [Key Design Decisions](#key-design-decisions)

---

## System Overview

Bills-Node-Server is a Node.js + Express + TypeScript backend that powers a personal financial planning and bill management application. It provides projection modeling, budget tracking, healthcare cost estimation, retirement planning, and Monte Carlo simulation capabilities.

### Core Technology Stack

| Component       | Technology                |
|-----------------|---------------------------|
| Runtime         | Node.js 23                |
| Framework       | Express                   |
| Language        | TypeScript                |
| Authentication  | JWT (JSON Web Tokens)     |
| User Storage    | MySQL                     |
| Financial Data  | JSON file persistence     |
| Testing         | Vitest                    |
| Date Handling   | dayjs                     |

### High-Level Architecture

```
┌──────────────┐       ┌───────────────────────────────────────────────┐
│              │       │           Bills-Node-Server                   │
│ Bills-Client │       │                                               │
│  (React)     │──────>│  Express ──> Auth ──> Route Handlers          │
│              │ /api  │                          │                     │
│              │<──────│                     getData()                  │
│              │       │                          │                     │
└──────────────┘       │              ┌───────────┴──────────┐         │
                       │              │                      │         │
                       │       Calculation Engine       JSON Files     │
                       │       (v1 / v2 / v3)          (persistence)  │
                       │              │                      │         │
                       │              └──────────────────────┘         │
                       │                                               │
                       │         MySQL (auth only)                     │
                       └───────────────────────────────────────────────┘
```

### Calculation Engine Versions

The server maintains three versions of the financial calculation engine:

| Version | Status       | Description                                      |
|---------|--------------|--------------------------------------------------|
| v1      | Legacy       | Original implementation, still present in codebase |
| v2      | Previous     | Production version with caching support          |
| v3      | Development  | Event-driven, segment-based architecture         |

---

## Architecture Layers

Requests flow through a well-defined pipeline from HTTP entry to data persistence:

```
                    ┌─────────────────┐
                    │   HTTP Request   │
                    └────────┬────────┘
                             │
                    ┌────────v────────┐
                    │   Express Router │  (index.ts - route registration)
                    │   + JWT Auth     │
                    └────────┬────────┘
                             │
                    ┌────────v────────┐
                    │  API Handlers    │  (src/api/[domain]/)
                    │  (Route Logic)   │  - Request validation
                    └────────┬────────┘  - Response formatting
                             │
                    ┌────────v────────┐
                    │   getData()      │  (Load financial data from JSON)
                    └────────┬────────┘
                             │
                    ┌────────v────────┐
                    │  Calculation     │  (src/utils/calculate-v3/)
                    │  Engine          │  - Timeline generation
                    └────────┬────────┘  - Event processing
                             │           - Balance projection
                    ┌────────v────────┐
                    │  Data            │  (src/utils/io/data/)
                    │  Persistence     │  - JSON file read/write
                    └─────────────────┘  - Backup rotation
```

### Request Pattern

All API handlers follow a consistent pattern:

```typescript
async function handler(req: Request) {
  const data = await getData(req);  // Load simulation data
  // ... business logic
  // ... return response
}
```

The `getData()` function loads the appropriate financial data based on the currently selected simulation (passed as a query parameter).

---

## Data Models

### Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────┐
│                     Account                          │
│─────────────────────────────────────────────────────│
│  id, name, type, balance, hidden                     │
│  tax settings, RMD settings, push/pull config        │
│                                                      │
│  ┌─────────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Interest[]   │  │ Bill[]   │  │ Activity[]    │  │
│  └─────────────┘  └──────────┘  └───────────────┘  │
│                                                      │
│  ┌───────────────────────────┐                      │
│  │ ConsolidatedActivity[]    │  (computed)           │
│  └───────────────────────────┘                      │
└─────────────────────────────────────────────────────┘

         ┌──────────────────────────────┐
         │   AccountsAndTransfers       │
         │──────────────────────────────│
         │  accounts: Account[]         │
         │  transfers:                  │
         │    activity: Activity[]      │
         │    bills: Bill[]             │
         └──────────────────────────────┘
```

### Account

The central entity representing a financial account.

| Field                 | Type                        | Description                                    |
|-----------------------|-----------------------------|------------------------------------------------|
| `id`                  | `string`                    | Unique identifier                              |
| `name`                | `string`                    | Display name                                   |
| `type`                | `string`                    | Account type (checking, savings, investment, etc.) |
| `balance`             | `number`                    | Current balance                                |
| `hidden`              | `boolean`                   | Whether to hide from default views             |
| `interests`           | `Interest[]`                | Interest rate configurations                   |
| `activities`          | `Activity[]`                | One-time transactions                          |
| `bills`               | `Bill[]`                    | Recurring transactions                         |
| `consolidatedActivity`| `ConsolidatedActivity[]`    | Computed view of all activity (generated)      |
| `tax settings`        | `object`                    | Tax treatment configuration                    |
| `RMD settings`        | `object`                    | Required Minimum Distribution configuration    |
| `push/pull config`    | `object`                    | Automatic transfer behavior                    |

### Activity

Represents a one-time financial transaction.

| Field              | Type                              | Description                                      |
|--------------------|-----------------------------------|--------------------------------------------------|
| `id`               | `string`                          | Unique identifier                                |
| `name`             | `string`                          | Description                                      |
| `category`         | `string`                          | Transaction category                             |
| `amount`           | `number \| string`                | Amount or special fraction (see below)           |
| `date`             | `string`                          | Date in `YYYY-MM-DD` format                      |
| `flag`             | `string`                          | Status flag                                      |
| `transfer`         | `object`                          | Transfer destination info                        |
| `variable`         | `string`                          | Variable name for simulation scenarios           |
| `healthcare`       | `object`                          | Healthcare-related fields                        |
| `spendingCategory` | `string`                          | Spending tracker category reference              |

#### Special Amount Values

Activities and bills support special fractional amount strings for split transactions:

| Value      | Meaning                          |
|------------|----------------------------------|
| `{HALF}`   | Positive half of a referenced amount |
| `{FULL}`   | Full positive amount             |
| `-{HALF}`  | Negative half of a referenced amount |
| `-{FULL}`  | Full negative amount             |

### Bill

Extends the activity pattern with recurrence configuration.

| Field                  | Type       | Description                                    |
|------------------------|------------|------------------------------------------------|
| *(all Activity fields)*|            | Inherits activity fields                       |
| `everyN`               | `number`   | Recurrence interval                            |
| `periods`              | `string`   | Recurrence period unit (days, weeks, months, years) |
| `annualDateRange`      | `object`   | Active date range within each year             |
| `inflation`            | `object`   | Inflation adjustment configuration             |
| `increase`             | `object`   | Periodic increase configuration                |
| `monteCarloSampleType` | `string`   | Sampling strategy for Monte Carlo simulations  |

### Interest

Defines interest rate behavior for an account.

| Field              | Type       | Description                               |
|--------------------|------------|-------------------------------------------|
| `APR`              | `number`   | Annual Percentage Rate                    |
| `compoundFrequency`| `string`   | How often interest compounds              |
| `applicableDate`   | `string`   | When this rate takes effect               |
| `variable`         | `string`   | Variable name for scenario support        |

### ConsolidatedActivity

A computed entity that merges all transaction types into a unified view.

| Field                   | Type       | Description                                  |
|-------------------------|------------|----------------------------------------------|
| *(all Activity fields)* |            | Inherits activity fields                     |
| `billId`                | `string`   | Source bill ID (if generated from a bill)     |
| `firstBill`             | `boolean`  | Whether this is the first instance of a bill  |
| `interestId`            | `string`   | Source interest ID (if from interest)         |
| `firstInterest`         | `boolean`  | Whether this is the first interest event      |
| `spendingTrackerId`     | `string`   | Source spending tracker ID                    |
| `firstSpendingTracker`  | `boolean`  | Whether this is the first tracker event       |
| `balance`               | `number`   | Running account balance after this activity   |

### Supporting Models

#### Pension / Social Security

Retirement income models with birth date and benefit calculation parameters.

#### HealthcareConfig

Insurance plan configuration with deductible/out-of-pocket limits, covered persons, and HSA integration.

#### SpendingTrackerCategory

Budget tracking with threshold, interval, carry-over/under logic, and inflation adjustment.

---

## Calculation Engine (v3)

The v3 calculation engine uses an event-driven, segment-based architecture to project financial balances over time.

### Component Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Engine                                   │
│                     (Orchestrator)                                │
│                                                                   │
│  Entry: calculateAllActivity()                                    │
│  Manages: Timeline + SegmentProcessor                            │
└────────────┬─────────────────────────────┬───────────────────────┘
             │                             │
    ┌────────v────────┐          ┌─────────v──────────┐
    │    Timeline      │          │  SegmentProcessor   │
    │                  │          │                     │
    │ Generates events │          │ Processes segments  │
    │ from all sources │          │ with caching        │
    └────────┬─────────┘          └─────────┬──────────┘
             │                              │
             │    ┌─────────────────────────┐│
             │    │      Calculator         ││
             │    │                         ││
             │    │ Processes events by     ││
             │    │ type (10 event types)   ││
             │    └─────────────────────────┘│
             │                              │
    ┌────────v──────────────────────────────v───────────┐
    │                 Support Services                   │
    │                                                    │
    │  BalanceTracker    AccountManager    CacheManager  │
    │  PushPullHandler   TaxManager       HealthcareMan. │
    │  SpendingTracker   RetirementMan.                  │
    └────────────────────────────────────────────────────┘
```

### Processing Workflow

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  1. Timeline     │────>│  2. Segmentation  │────>│  3. Segment        │
│     Creation     │     │                  │     │     Processing      │
│                  │     │  Split events     │     │                    │
│  Generate all    │     │  into monthly     │     │  Check cache ──┐   │
│  financial       │     │  segments         │     │                │   │
│  events          │     │                  │     │  Process events │   │
└─────────────────┘     └──────────────────┘     │  by priority   │   │
                                                  │                │   │
                                                  │  Handle push/  │   │
                                                  │  pull transfers│   │
                                                  └────────┬───────┘   │
                                                           │           │
                                                  ┌────────v───────┐   │
                                                  │  4. Result      │   │
                                                  │     Aggregation │<──┘
                                                  │                 │
                                                  │  Combine all    │
                                                  │  segment results│
                                                  └─────────────────┘
```

### Event Sources and Priority

The Timeline generates events from multiple financial data sources. Events are assigned priorities that control processing order within each date:

| Priority | Event Types                                    | Rationale                                            |
|----------|------------------------------------------------|------------------------------------------------------|
| 0        | Interest                                       | Accrue interest before any transactions              |
| 1        | Activities, Bills                              | Process regular transactions                         |
| 2        | Activity Transfers, Bill Transfers, Pension, Social Security | Process transfers and retirement income    |
| 2.5      | Spending Tracker                               | Track spending after transactions settle             |
| 3        | Tax, RMD                                       | Calculate taxes/distributions after all activity     |

### 10 Event Types

The Calculator handles these distinct event types:

1. **Activity** -- One-time transaction
2. **Bill** -- Recurring transaction
3. **Interest** -- Interest accrual
4. **ActivityTransfer** -- One-time transfer between accounts
5. **BillTransfer** -- Recurring transfer between accounts
6. **Pension** -- Pension income
7. **SocialSecurity** -- Social Security income
8. **Tax** -- Tax liability calculation
9. **RMD** -- Required Minimum Distribution
10. **SpendingTracker** -- Budget tracking event

### Component Responsibilities

#### Engine (Orchestrator)

- Entry point via `calculateAllActivity()`
- Coordinates Timeline and SegmentProcessor
- Returns aggregated results for all accounts

#### Timeline

- Generates all financial events from accounts, bills, activities, transfers, pensions, Social Security, taxes, RMDs, and spending tracker categories
- Assigns event priorities for correct processing order
- Splits events into monthly segments

#### SegmentProcessor

- Processes each monthly segment
- Checks the cache before recalculating
- Groups events by date within a segment
- Processes events in priority order
- Triggers push/pull creation when needed

#### BalanceTracker

- Maintains running account balances throughout the projection
- Creates snapshots for cache recovery
- Filters consolidated activities by date range for API responses

#### AccountManager

- Registry for accounts by both name and ID
- Tracks which accounts are "pullable" (can be drawn from automatically)

#### PushPullHandler

- Detects when account balances cross thresholds requiring automatic transfers
- Creates push activities (excess funds moved out) and pull activities (deficit funded from another account)

#### TaxManager

- Accumulates taxable events organized by year and account
- Calculates total tax owed per year
- Generates tax payment events

#### HealthcareManager

- Tracks deductible and out-of-pocket spending by person and plan year
- Calculates patient responsibility after insurance
- Handles HSA reimbursement logic
- Idempotent via expense cache (safe for segment re-processing)

#### SpendingTrackerManager

- Tracks spending against budget thresholds
- Handles carry-over (unused budget rolls forward) and carry-under (overspend carried as debt)
- Supports checkpoint/restore for segment re-processing

#### RetirementManager

- Tracks pension and Social Security annual incomes
- Loads RMD life expectancy tables for distribution calculations

#### CacheManager

- Two-level caching:
  - **Calculation-level cache**: Full calculation results
  - **Segment-level cache**: Individual monthly segment results
- Maintains balance snapshots for partial recalculation
- Supports disk persistence for cache durability
- Cache is reset on data save

### Cache Observability Events

The calc-v3 segment processor emits debug events under the `segment` component. All events are emitted only when a `DebugLogger` is attached to the current calculation and are zero-cost otherwise.

| Event | Payload | Description |
|-------|---------|-------------|
| `cache-hit` | `segmentId`, `startDate`, `endDate` | Segment result found in cache |
| `cache-miss` | `segmentId`, `startDate`, `endDate` | Cache lookup returned null |
| `cache-populate` | `segmentId`, `startDate`, `endDate` | Fresh result written via `setSegmentResult` |
| `segment-compute-start` | `segmentId`, `startDate`, `endDate` | Fresh segment computation beginning |
| `cache-skip` | `segmentId`, `startDate`, `endDate`, `reason` | Cache lookup skipped; `reason` is `'forceRecalculation'` or `'monteCarlo'` |

### Enabling Debug Logging

Two paths attach a `DebugLogger` to a calculation run:

**Monte Carlo runs** — pass `--debug <sim-numbers>` to `scripts/run_mc.sh`. For a deterministic-only run (skips Monte Carlo variance), also pass `--deterministic-only`. The deterministic-only pass logs to `sim-1.jsonl` (batch loop numbering starts at 1).

**Main server HTTP requests** — append `?debug=true` to any endpoint that routes through `getData()` (e.g., `/api/accounts/graph`, `/api/healthcare/projections`). The `debugLoggerMiddleware` creates a `DebugLogger`, attaches it to `req._debugLogger`, and writes the `X-Debug-Log-Dir` response header with the output path. Main-process calculations log under simulation number 0 to `/tmp/debug-<uuid>/det.jsonl`.

Debug logging is independent of cache bypass. To force recalculation, pass `?forceRecalculation=true` separately.

### Selective Cache Clearing

`POST /api/cache/clear` accepts an optional `target` query parameter:

| `target` value | Effect |
|----------------|--------|
| `all` (default) | Clears everything: engine calc results, segment cache, balance snapshots, projections, graph cache, data cache, retirement/ACA/Medicare/contribution/glide-path caches |
| `calc` | Clears engine calc results, projections, graph, and data caches only. Preserves segment cache and balance snapshots, allowing warm segment-level hits on the next request. |

Unknown `target` values return `400`. Future target values (`segments`, `balance-snapshots`, `ancillary`) are planned.

### Cache Test Harness (EPIC-033 verification)

Provides a reproducible way to invoke the calc-v3 engine against a frozen data fixture. Stages 003–005 of EPIC-033 build their verification tests on top of this harness.

#### Key files

| Path | Purpose |
|------|---------|
| `test/fixtures/epic-033-data/` | Frozen ~16 MB snapshot of `data/`, excluding `backup/`, `monteCarlo/`, and `simulations/` subdirectories. Contains input-structural state only. |
| `test/helpers/cache-test-harness.ts` | Exports `createHarness(options)` factory. |
| `test/helpers/cache-test-harness.test.ts` | 3 smoke tests (no engine run). |
| `test/helpers/cache-test-harness.integration.test.ts` | 4 integration tests that run the real engine against the fixture. |
| `scripts/refresh-epic-033-fixture.sh` | Regenerates the fixture from the current `data/` directory, excluding stateful subdirs. Run when real data gains a new input-structural field. |

#### `createHarness` options

```typescript
createHarness({
  fixtureDir: string,   // path to frozen fixture (usually test/fixtures/epic-033-data/)
  endDate: string,      // projection end date (YYYY-MM-DD)
  simulation?: string,  // simulation name; defaults to "Default"
  debugLogDir?: string, // directory for JSONL debug output; defaults to a temp path
})
```

#### Harness methods

| Method | Description |
|--------|-------------|
| `runCold(options?)` | Clears all caches (mirrors `?target=all`), then runs the engine. Returns `{ result, debugLogPath, managerStates }`. |
| `runWarm(options?)` | Clears only outer calculation caches (mirrors `?target=calc`), preserving the segment cache from a prior cold run. Returns the same shape. Segments with preserved entries emit `cache-hit` events (see [Cache Observability Events](#cache-observability-events)). |
| `loadDebugEvents(logPath)` | Parses JSONL debug output into typed events. |
| `assertCacheHits(events, { dateRange })` | Asserts every segment overlapping the range had a `cache-hit` and no `segment-compute-start`. Throws with a diff on failure. |
| `assertCacheMisses(events, { dateRange })` | Inverse of `assertCacheHits`. |
| `compareManagerStates(warm, cold)` | Deep-equal comparison across TaxManager, HealthcareManager, SpendingTrackerManager, RetirementManager, MedicareManager, and AcaManager snapshots. Epsilon-aware for floats; null-safe for partially-populated managers. |
| `compareAccountsAndTransfers(warm, cold)` | Deep-equal comparison of the top-level `AccountsAndTransfers` result. |

#### Data-path override

The harness sets `process.env.BILLS_DATA_DIR` to the fixture path before engine boot. All callers that reach data via `getDataDir()` in `src/utils/io/io.ts` see the fixture instead of `data/`. A path-inside-fixture guard inside `runCold`/`runWarm` throws if the resolved env var points outside `test/fixtures/`.

#### Manager snapshots

Each manager exposes a `snapshot()` method returning a deterministic plain object. TaxManager and HealthcareManager have rich state. MedicareManager and AcaManager are placeholders — `TODO(STAGE-033-005)` to flesh out when drill-down tests need them.

#### Long-horizon tests

Files matching `**/*.long.test.ts` run only via `npm run test:long` (uses `vitest.long.config.ts`, 120 s timeout, coverage disabled). The default `npm test` and `npm run test:run` exclude them.

### Cache Effectiveness Tests (EPIC-033 STAGE-033-003)

These tests prove that the segment cache **actually skips work** on warm runs. They are not correctness tests — result accuracy is addressed in stages 004 and 005.

#### Test files

| Path | What it asserts |
|------|-----------------|
| `test/cache/effectiveness-cold-run.test.ts` | Cold run emits `cache-populate` for every segment and zero `cache-hit` events. |
| `test/cache/effectiveness-warm-run.test.ts` | Warm run (following a cold run) emits `cache-hit` for every segment and zero `segment-compute-start` events. |
| `test/cache/effectiveness-incremental-extend.test.ts` | Cold run to 2028, then warm run to 2029. Segments within the original range emit `cache-hit`; only the newly added range emits `cache-miss` and `cache-populate`. |
| `test/cache/effectiveness-incremental-extend-far.long.test.ts` | Same incremental pattern at 2030→2080 scale. Opt-in only via `npm run test:long`. |
| `test/cache/effectiveness-zero-compute-on-hit.test.ts` | For every `cache-hit` event, asserts that no `segment-compute-start` event shares the same `segmentId`. This is a regression guard for the early-return path at `src/utils/calculate-v3/segment-processor.ts:176`. |

All five files use `createHarness()` and the frozen `test/fixtures/epic-033-data/` fixture from STAGE-033-002.

#### How to run

```bash
# Default suite (excludes long-horizon file)
npx vitest run test/cache/

# Include long-horizon file (2030→2080 scale, ~120 s timeout)
npm run test:long
```

#### What this suite does NOT prove

These tests verify work-skipping behavior only. They do not assert that warm and cold runs produce identical financial results — that is the responsibility of the correctness tests in stages 004 and 005.

#### Known gap

Harness cleanup may leak `/tmp/debug-<uuid>` directories on test-failure paths. This is non-blocking and documented in `epics/EPIC-033-calculation-cache/regression.md`.

---

## API Endpoints

The server exposes 60+ REST endpoints organized by domain. All endpoints (except `/auth/login`) require JWT authentication. The selected simulation ID is passed as a query parameter on all requests.

### Endpoint Summary

#### Accounts

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/accounts`                               | List all accounts                    |
| POST   | `/api/accounts`                               | Create account                       |
| PUT    | `/api/accounts/:id`                           | Update account                       |
| DELETE | `/api/accounts/:id`                           | Delete account                       |
| GET    | `/api/accounts/graph`                         | Get balance projection graph data    |
| GET    | `/api/accounts/todayBalance`                  | Get current-day balances             |

#### Account Sub-Resources

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/accounts/:id/activity`                  | List activities for account          |
| POST   | `/api/accounts/:id/activity`                  | Create activity                      |
| PUT    | `/api/accounts/:id/activity/:actId`           | Update activity                      |
| DELETE | `/api/accounts/:id/activity/:actId`           | Delete activity                      |
| GET    | `/api/accounts/:id/bills`                     | List bills for account               |
| POST   | `/api/accounts/:id/bills`                     | Create bill                          |
| PUT    | `/api/accounts/:id/bills/:billId`             | Update bill                          |
| DELETE | `/api/accounts/:id/bills/:billId`             | Delete bill                          |
| GET    | `/api/accounts/:id/interests`                 | List interest configs                |
| POST   | `/api/accounts/:id/interests`                 | Create interest config               |
| PUT    | `/api/accounts/:id/interests/:intId`          | Update interest config               |
| DELETE | `/api/accounts/:id/interests/:intId`          | Delete interest config               |
| GET    | `/api/accounts/:id/consolidated_activity`     | Get computed consolidated view       |

#### Categories

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/categories`                             | List all categories                  |
| POST   | `/api/categories`                             | Create category                      |
| PUT    | `/api/categories/:id`                         | Update category                      |
| DELETE | `/api/categories/:id`                         | Delete category                      |
| GET    | `/api/categories/breakdown`                   | Category spending breakdown          |
| GET    | `/api/categories/section-transactions`        | Transactions by category section     |

#### Simulations

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/simulations`                            | List simulations                     |
| POST   | `/api/simulations/load`                       | Load simulation data                 |
| POST   | `/api/simulations/save`                       | Save simulation data                 |
| GET    | `/api/simulations/used_variables`             | List variables used in simulation    |

#### Calendar

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/calendar/bills`                         | Get bills for calendar view          |

#### Healthcare

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/healthcare`                             | List healthcare configs              |
| POST   | `/api/healthcare`                             | Create healthcare config             |
| PUT    | `/api/healthcare/:id`                         | Update healthcare config             |
| DELETE | `/api/healthcare/:id`                         | Delete healthcare config             |
| GET    | `/api/healthcare/progress`                    | Deductible/OOP progress              |
| GET    | `/api/healthcare/expenses`                    | Healthcare expense details           |
| GET    | `/api/healthcare/history`                     | Historical healthcare data           |

#### Spending Tracker

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/spending-tracker`                       | List spending categories             |
| POST   | `/api/spending-tracker`                       | Create spending category             |
| PUT    | `/api/spending-tracker/:id`                   | Update spending category             |
| DELETE | `/api/spending-tracker/:id`                   | Delete spending category             |
| GET    | `/api/spending-tracker/chart-data`            | Spending chart data                  |

#### Monte Carlo

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| POST   | `/api/monte_carlo/start`                      | Start Monte Carlo simulation         |
| GET    | `/api/monte_carlo/status`                     | Check simulation progress            |
| GET    | `/api/monte_carlo/results`                    | Get simulation results               |

#### Other

| Method | Endpoint                                      | Description                          |
|--------|-----------------------------------------------|--------------------------------------|
| GET    | `/api/moneyMovement`                          | Money movement analysis              |
| GET    | `/api/flow`                                   | Flow/Sankey diagram data             |
| GET    | `/api/names`                                  | Account/bill/activity name lookups   |

---

## Data Persistence

### Storage Strategy

The application uses a dual storage approach:

- **MySQL**: User authentication data only (accounts, passwords, tokens)
- **JSON Files**: All financial planning data (accounts, bills, activities, simulations, etc.)

### File Layout

```
src/utils/io/data/
├── data.json                         # Primary financial data (accounts, bills, activities)
├── simulations.json                  # Simulation definitions and metadata
├── variables.csv                     # Variable definitions for simulation scenarios
├── pension_and_social_security.json  # Retirement income configurations
├── categories.json                   # Transaction categories
├── healthcare_configs.json           # Healthcare plan configurations
├── spending_tracker.json             # Spending tracker categories
├── bend_points.json                  # Social Security bend point data
├── average_wage_index.json           # Social Security wage index data
└── backup/                           # Automatic backup directory
```

### Backup System

The server implements automatic backup rotation:

- **Trigger**: Every 10 saves
- **Retention**: Maximum 10 backup copies
- **Scope**: Main data file (`data.json`)
- **Behavior**: Oldest backup is removed when the limit is reached

### Cache Invalidation

All calculation caches (both calculation-level and segment-level) are reset whenever data is saved. This ensures that subsequent reads always reflect the latest state.

---

## Monte Carlo Simulation

Monte Carlo simulation provides statistical modeling of future financial outcomes under market uncertainty.

### Architecture

```
┌───────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  POST /start   │────>│  Batch Processor  │────>│  Calculation     │
│                │     │                  │     │  Engine (v3)     │
│  Configure     │     │  N iterations    │     │                  │
│  parameters    │     │  Deep-cloned     │     │  Stochastic      │
│                │     │  data per run    │     │  rate sampling   │
└───────────────┘     └────────┬─────────┘     └─────────────────┘
                               │
                      ┌────────v─────────┐
                      │  GET /status      │
                      │  Progress %       │
                      └────────┬─────────┘
                               │
                      ┌────────v─────────┐
                      │  GET /results     │
                      │  Percentile stats │
                      └──────────────────┘
```

### Key Characteristics

| Aspect                | Detail                                                    |
|-----------------------|-----------------------------------------------------------|
| **Rate Sampling**     | Historical market rates used for stochastic return modeling |
| **Portfolio Model**   | Portfolio composition evolves over the projection timeline |
| **Isolation**         | Each iteration uses a deep clone of all financial data    |
| **Progress Tracking** | Batch processing with percentage-complete status endpoint |
| **Output Statistics** | Percentile results: 10th, 25th, 50th, 75th, 90th         |

### Sample Types

Bills can specify a `monteCarloSampleType` to control how their amounts are varied across simulation iterations (e.g., fixed, normal distribution, historical sampling).

---

## Key Design Decisions

### 1. Special Amount Values (`{HALF}`, `{FULL}`)

Activities and bills support string-based amount tokens for split transactions. This allows a single source transaction to be divided across accounts without hard-coding dollar amounts:

```
Amount: {HALF}   -->  50% of the reference amount (positive)
Amount: {FULL}   -->  100% of the reference amount (positive)
Amount: -{HALF}  -->  50% of the reference amount (negative)
Amount: -{FULL}  -->  100% of the reference amount (negative)
```

This is particularly useful for transfers where one side is a debit and the other a credit of the same amount.

### 2. Simulation Variables

Variables (stored in `variables.csv`) allow users to model different financial scenarios without duplicating data. A single simulation can use variables for amounts, interest rates, or dates, and switching variable values instantly recalculates all projections.

### 3. Event Priority Ordering

The priority system (0 through 3) ensures deterministic and financially correct processing order within each date:

1. **Interest and push/pull transfers first (0)**: Accrued interest updates balances before transactions; auto-generated push/pull transfers also run at this level to rebalance accounts early
2. **Activities and activity transfers (1)**: One-time transactions and manual inter-account transfers process against updated balances
3. **Bills, bill transfers, and retirement income (2)**: Recurring bill payments, bill-driven inter-account transfers, social security, and pension income
4. **Spending tracking (2.5)**: Budget tracking after transactions settle
5. **Tax and RMD last (3)**: Calculated after all other financial activity is known

### 4. Noon UTC Timestamps

All date-based events use noon UTC (12:00:00Z) to prevent timezone boundary issues. This avoids scenarios where a transaction dated "2026-03-15" might appear on March 14th or 16th depending on the local timezone.

### 5. Deep Cloning for Monte Carlo

Each Monte Carlo iteration operates on a deep clone of the full financial dataset. This ensures:

- No cross-contamination between iterations
- Thread-safe parallel processing
- Deterministic results for any given random seed

### 6. Idempotent Healthcare Calculations

The HealthcareManager maintains an expense cache that makes calculations idempotent. When segments are re-processed (e.g., due to cache invalidation of a single segment), healthcare calculations produce identical results without double-counting expenses. This is critical because healthcare tracking is stateful (deductible progress accumulates across the year).

### 7. Two-Level Caching

The cache system operates at two granularities:

- **Calculation-level**: Caches the entire projection result. Fast but invalidated by any data change.
- **Segment-level**: Caches individual monthly segments. Allows partial recalculation when only recent data changes, preserving cached results for historical segments.

Balance snapshots at segment boundaries enable the engine to resume calculation from any point without reprocessing the entire timeline.

### 8. JSON File Persistence

Choosing JSON files over a full database for financial data provides:

- **Simplicity**: No ORM, migrations, or schema management
- **Portability**: Data is human-readable and easily backed up
- **Atomicity**: Entire dataset loaded/saved as one unit
- **Simulation isolation**: Each simulation can have independent data files

The trade-off is that concurrent write access is not supported (single-user application by design).
