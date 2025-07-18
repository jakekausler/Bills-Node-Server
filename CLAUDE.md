# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Development server**: `npm run dev` - Starts the server with hot reloading using tsx
- **Build**: `npm run build` - Compiles TypeScript to JavaScript in the dist/ directory
- **Production**: `npm start` - Runs the compiled JavaScript from dist/index.js
- **Lint**: `npm run lint` - Runs ESLint on all TypeScript files in src/
- **Test**: `npm test` - Runs Vitest in watch mode for development
- **Test (run once)**: `npm run test:run` - Runs all tests once and exits
- **Test UI**: `npm run test:ui` - Opens Vitest UI for interactive testing
- **Test Coverage**: `npm run test:coverage` - Runs tests with coverage report

## Project Architecture

This is a financial planning and bill management API server built with Node.js, Express, and TypeScript. The system handles accounts, bills, activities, and financial calculations with future projections.

### Core Data Flow

1. **Data Storage**: JSON files in `src/utils/io/data/` serve as the database
2. **Data Models**: Located in `src/data/` with classes for Account, Bill, Activity, Interest, etc.
3. **API Layer**: Express routes in `src/api/` organized by feature (accounts, bills, categories, etc.)
4. **Calculation Engine**: Complex financial calculations in `src/utils/calculate/`
5. **I/O Layer**: File operations and data persistence in `src/utils/io/`

### Key Architecture Components

- **Account System**: Supports multiple account types with different tax rates, withdrawal penalties, and RMD requirements
- **Activity Tracking**: Records all financial transactions with consolidated activity views
- **Bill Management**: Recurring bills with inflation adjustments and date calculations
- **Interest Calculations**: Compound interest with historical rate lookups
- **Retirement Planning**: Social Security, pension, and RMD calculations
- **Monte Carlo Simulations**: Statistical modeling for financial projections
- **Graph Generation**: Balance and activity charting over time

### Data Models Hierarchy

```
AccountsAndTransfers
├── Account[] - Financial accounts with balances and metadata
│   ├── Activity[] - Manual transactions
│   ├── Bill[] - Recurring payments/income
│   ├── Interest[] - Interest rate configurations
│   └── ConsolidatedActivity[] - Computed view of all activities
└── Transfer[] - Money movements between accounts
```

### Critical File Locations

- Main entry point: `src/index.ts`
- Core calculation engine: `src/utils/calculate/calculate.ts`
- Data persistence: `src/utils/io/io.ts`
- Account model: `src/data/account/account.ts`
- API route definitions: All routes defined in `src/index.ts`

### Testing Structure

- **Test Framework**: Vitest with coverage reporting via v8
- **Test Files**: Located alongside source files with `.test.ts` extension
- **Test Configuration**: `vitest.config.ts` - includes coverage settings and path aliases
- **Coverage Exclusions**: `calculate` utility folder is excluded from coverage as it's being overhauled
- **Mock Strategy**: Extensive use of vi.mock() for dependency isolation in unit tests

### Authentication & Security

- JWT-based authentication with MySQL user storage
- All API endpoints (except auth) require valid JWT token
- Registration is disabled in production
- Uses bcrypt for password hashing

### Environment Variables

Required environment variables:
- `PORT` - Server port (defaults to 5002)
- `JWT_SECRET` - JWT signing secret
- `MYSQL_HOST`, `MYSQL_USERNAME`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` - Database connection

### Data File Structure

The system uses JSON files for data persistence in `src/utils/io/data/`:
- `data.json` - Main accounts and transfers data
- `simulations.json` - Monte Carlo simulation configurations
- `variables.csv` - Simulation variables
- `pension_and_social_security.json` - Retirement data
- Automatic backups created every 10 saves in `backup/` directory

### Code Quality & Maintenance

- **Documentation**: JSDoc comments added to all public functions, classes, and methods
- **Refactoring**: Large functions broken down into smaller, testable units (e.g., `updateAccounts` function)
- **Test Coverage**: Comprehensive unit tests for data models, API endpoints, and utility functions
- **Type Safety**: Full TypeScript implementation with strict type checking