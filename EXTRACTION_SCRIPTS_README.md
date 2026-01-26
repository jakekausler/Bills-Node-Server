# Bills Data Extraction Scripts

Two utility scripts for extracting and analyzing data from Bills application data files.

## Scripts

### 1. extract-bills.js

Extracts all recurring bills from the Bills application data structure.

**Usage:**
```bash
node extract-bills.js <path-to-data.json>
```

**Example:**
```bash
node extract-bills.js /storage/docker/bills/data/data.json
```

**What it extracts:**
- **Account Bills**: Recurring bills associated with specific accounts
  - Income (salary, pensions, etc.)
  - Expenses (subscriptions, utilities, etc.)
  - Healthcare expenses
- **Transfer Bills**: Recurring transfers between accounts
  - Automatic transfers
  - Mortgage payments
  - Account funding transfers

**Output:**
- Formatted text report to stdout
- JSON file saved to same directory as input (if writable)

**Data Structure Discovered:**
```
data.json
├── accounts[] - Array of financial accounts
│   └── bills[] - Recurring bills for each account
└── transfers - Transfer management object
    ├── activity[] - One-time transfers (historical)
    └── bills[] - Recurring transfer bills
```

### 2. extract-variables.js

Extracts simulation variables from the Bills application CSV file.

**Usage:**
```bash
node extract-variables.js <path-to-variables.csv>
```

**Example:**
```bash
node extract-variables.js /storage/docker/bills/data/variables.csv
```

**What it extracts:**
- Variables from the "Default" simulation column
- Automatically categorizes variables by type:
  - **Date variables**: Birth dates, retirement dates, etc.
  - **Rate variables**: Interest rates, inflation, etc. (displayed as percentages)
  - **Currency variables**: Income, spending, contributions, etc.
  - **Numeric variables**: Other numeric values

**Output:**
- Formatted text report to stdout (grouped by type and alphabetically)
- JSON file saved to same directory as input (if writable)

**Data Structure Discovered:**
```
variables.csv format:
Row 1: variable,Default,Kendall Low Pay,...
Row 2+: VARIABLE_NAME,defaultValue,altValue,...
```

## Sample Output

### Bills Extraction Summary
```
Total Account Bills: 92
Total Transfer Bills: 12
Total Bills: 104
```

Examples include:
- Income sources (salary, pensions)
- Fixed expenses (subscriptions, insurance)
- Healthcare expenses (therapy, doctor visits)
- Transfer rules (account funding, mortgage)

### Variables Extraction Summary
```
Total Variables: 29

Categories:
- 9 Date variables (retirement dates, birth dates)
- 6 Rate variables (inflation, interest rates)
- 13 Currency variables (income, spending)
- 1 Numeric variable
```

## Notes

- Scripts are read-only and do not modify source data
- JSON output requires write permissions to the source directory
- If write permissions are denied, the text report is still displayed
- Both scripts include comprehensive error handling

## Implementation Details

### Bills Data Model

Each bill contains:
- `name`: Bill description
- `amount`: Dollar amount (can be variable)
- `frequency`: How often it occurs (everyN periods)
- `startDate` / `endDate`: Date range
- `increaseBy`: Inflation adjustment rate
- `category`: Transaction category
- `isTransfer`: Whether it's a transfer between accounts
- `isAutomatic`: Whether it's automatically applied
- `isHealthcare`: Whether it's a healthcare expense
- `flag` / `flagColor`: Visual markers in the UI

### Variables Data Model

Each variable contains:
- `name`: Variable identifier (e.g., "KENDALL_PAY")
- `value`: Numeric or date value
- `type`: Inferred type (date, rate, currency, number, other)

Variables are used throughout the application to:
- Parameterize bill amounts
- Set retirement dates
- Configure interest rates
- Control inflation adjustments
