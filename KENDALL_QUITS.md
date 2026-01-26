# KENDALL_QUITS.md - Dev vs Prod Data Comparison

## Overview

**Bills:**
- **Dev**: 92 account bills + 15 transfer bills = **107 total**
- **Prod**: 92 account bills + 12 transfer bills = **104 total**
- Dev has **3 more transfer bills**

**Variables:**
- **Dev**: **46 variables** (17 unique to dev)
- **Prod**: **29 variables**

---

## Major Differences

### 1. **Kendall's Employment Status** (Biggest Change)

**Dev models Kendall quitting her job on 2025-12-31:**
- Variable: `KENDALL_QUIT_DATE = 2025-12-31`
- Kendall Income ends 2025-12-31 (dev) vs continues to 2048-07-15 (prod)
- Kendall 401(k) contributions end 2025-12-31 (dev) vs continue to 2048-07-15 (prod)
- **New in dev**: "Kendall Paycheck" bill ($1,500 every 2 weeks starting 2026-02-01)
- **New in dev**: Transfer from Jake to Kendall ($725/month)
- **New in dev**: Jake Healthcare for Kendall Adjustment (-$200 every 2 weeks)

### 2. **Retirement Timeline Shift** (7-Year Difference)

- `RETIRE_DATE`: **2055-07-15** (dev) vs **2048-07-15** (prod)
- `KENDALL_PENSION_START_DATE`: 2084-07-14 (dev) vs 2048-07-14 (prod)
- This affects when various benefits, contributions, and bills end

### 3. **Future Home Purchase Plan** (Dev Only)

Dev has 9 variables for a **2026 home purchase planned for 2084**:
- `2026_HOME_DOWN_PAYMENT`: -$30,000
- `2026_HOME_MORTGAGE_FINANCED`: -$350,000
- `2026_HOME_MORTGAGE_AMOUNT`: $2,500/month
- `2026_HOME_MORTGAGE_RATE`: 6%
- `2026_HOME_MORTGAGE_START`: 2084-03-01
- `BLOSSOM_SELL_DATE`: 2084-08-01 (current home)
- `BLOSSOM_SELL_PROFIT`: $20,000
- **New transfer bill**: "2026 Mortgage" ($2,500/month to Mortgage account)

### 4. **Budget Tightening in Dev**

All major spending categories **cut in half or eliminated**:

| Category | Dev | Prod | Difference |
|----------|-----|------|------------|
| Vacation Spending | -$5,000 | -$10,000 | **-50%** |
| Emergency Spending | -$5,000 | -$10,000 | **-50%** |
| Shared Spending | -$600 | -$1,300 | **-54%** |
| Jake Spending | $0 | -$200 | **-100%** |
| Kendall Extra Spending | $0 | -$285 | **-100%** |
| Jake Transfer to Spending | $90 | $290 | **-69%** |

### 5. **401(k) Contribution Changes**

- **Jake 401(k)**: $300/paycheck (dev) vs $943/paycheck (prod)
- **Dev adds**: `JAKE_401K_CONTRIBUTION_OFFSET` variable = $550
- This represents a **68% reduction** in Jake's retirement savings

### 6. **Service/Subscription Changes**

**Internet/Phone:**
- **Dev**: Single "At&t" bill in Costco account ($-232.30) + Google Fiber ($-50)
- **Prod**: Two bills in Jake account: "At&t" ($-211.78) + "At&t Internet" ($-50.19)

**Removed in dev:**
- iTalki Spanish (-$17.91 every 2 weeks)
- OpenAI (-$21.44/month)
- Hoot Food (-$72.59 every 10 weeks)

**Changed:**
- Claude: $-20/month (dev) vs $-200/month (prod) - **90% reduction**

### 7. **Transfer Bills Differences**

**Only in dev:**
1. **Transfer from Jake to Kendall** - $725/month (Variable: `TRANSFER_TO_KENDALL`)
2. **2026 Mortgage** - $2,500/month starting 2084-03-01
3. **Duplicate "Transfer from Jake to Costco"** (Bill #14 - appears to be a data error)

**Only in prod:**
- **Transfer from Fidelity to Money Market** - $300/month starting 2026-05-01

**Modified:**
- **Transfer from Jake to Spending**: $90 (dev) vs $290 (prod)
- **Transfer from Jake to Solar**: $500 ongoing (dev) vs $1,000 until 2027-11-08 (prod)

---

## Detailed Bill-by-Bill Comparison

### Account Bills with Major Differences

1. **Kendall Income** (Bill #4):
   - **Dev**: End Date: 2025-12-31
   - **Prod**: End Date: 2048-07-15
   - **Impact**: Kendall's City of Raleigh income stops at end of 2025 in dev scenario

2. **Kendall Paycheck** (Bill #14 - NEW in Dev):
   - Amount: $1,500 every 2 weeks
   - Start: 2026-02-01, End: 2055-07-15
   - **Impact**: New job or income source starting Feb 2026

3. **Jake Healthcare for Kendall Adjustment** (Bill #16 - NEW in Dev):
   - Amount: $-200 every 2 weeks (Variable: `JAKE_HEALTHCARE_FOR_KENDALL_ADJUSTMENT`)
   - **Impact**: Healthcare cost adjustment when Kendall changes jobs

4. **Jake 401k Offset** (Bill #19 - NEW in Dev):
   - Amount: $550 every 2 weeks (Variable: `JAKE_401K_CONTRIBUTION_OFFSET`)
   - **Impact**: Offset or adjustment to Jake's 401k contributions

5. **Nearpod** (Bill #15):
   - **Dev**: Amount: $3,025, End: 2055-07-15
   - **Prod**: Amount: $2,991.06, End: 2025-12-31
   - **Impact**: Higher pay and extended timeline in dev

6. **Jake 401(k) Contribution** (Bill #83/85):
   - **Dev**: $300 (Variable), End: 2055-07-15
   - **Prod**: $943, End: 2048-07-15
   - **Impact**: 68% reduction in retirement savings

7. **Vacation Spending** (Bill #28/29):
   - **Dev**: -$5,000
   - **Prod**: -$10,000
   - **Impact**: 50% reduction in vacation budget

8. **Emergency Spending** (Bill #29/30):
   - **Dev**: -$5,000 with 3% inflation
   - **Prod**: -$10,000 no inflation
   - **Impact**: 50% reduction in emergency spending

9. **Shared Spending** (Bill #71/74):
   - **Dev**: -$600
   - **Prod**: -$1,300
   - **Impact**: 54% reduction in shared expenses

10. **Monthly Spending** (Bill #35/36):
    - **Dev**: $0 (Variable: JAKE_SPENDING)
    - **Prod**: -$200 (Variable: JAKE_SPENDING)
    - **Impact**: Jake's personal spending eliminated

11. **Kendall Extra Spending** (Bill #89):
    - **Dev**: $0
    - **Prod**: -$285
    - **Impact**: Kendall's extra spending eliminated

12. **Claude** (Bill #77/80):
    - **Dev**: -$20
    - **Prod**: -$200
    - **Impact**: 90% reduction (possibly annual vs monthly billing)

### Service Changes

**Removed from dev:**
- **At&t** (Jake account): -$211.78/month
- **At&t Internet** (Jake account): -$50.19/month
- **iTalki Spanish** (REI account): -$17.91 every 2 weeks
- **OpenAI** (REI account): -$21.44/month
- **Hoot Food** (Costco account): -$72.59 every 10 weeks

**Added to dev:**
- **Google Fiber** (Costco account): -$50/month
- **At&t** (Costco account): -$232.30/month (consolidated)

---

## Variables Unique to Dev (17 total)

### Home Purchase Variables (9):
1. `2026_HOME_DILIGENCE_AMOUNT` = -$6,000
2. `2026_HOME_DILIGENCE_DUE` = 2084-02-01
3. `2026_HOME_DOWN_PAYMENT` = -$30,000
4. `2026_HOME_DOWN_PAYMENT_DUE` = 2084-02-28
5. `2026_HOME_MORTGAGE_AMOUNT` = $2,500
6. `2026_HOME_MORTGAGE_FINANCED` = -$350,000
7. `2026_HOME_MORTGAGE_RATE` = 6.00%
8. `2026_HOME_MORTGAGE_START` = 2084-03-01
9. `2026_HOME_MOVING_COST` = -$7,000

### Current Home Sale Variables (2):
10. `BLOSSOM_SELL_DATE` = 2084-08-01
11. `BLOSSOM_SELL_PROFIT` = $20,000

### Kendall Quit Scenario Variables (3):
12. `KENDALL_QUIT_DATE` = 2025-12-31
13. `KENDALL_QUIT_NEXT_EOM` = 2026-01-28
14. `TRANSFER_TO_KENDALL` = $725

### Jake Income/Contribution Variables (3):
15. `JAKE_401K_CONTRIBUTION` = $300
16. `JAKE_401K_CONTRIBUTION_OFFSET` = $550
17. `JAKE_HEALTHCARE_FOR_KENDALL_ADJUSTMENT` = -$200

---

## Variables with Different Values (8)

| Variable | Dev | Prod | Difference |
|----------|-----|------|------------|
| EMERGENCY_SPENDING | -$5,000 | -$10,000 | -50% |
| JAKE_SPENDING | $0 | -$200 | -100% |
| JAKE_TRANSFER_TO_SPENDING | $90 | $290 | -69% |
| KENDALL_EXTRA_SPENDING | $0 | -$285 | -100% |
| KENDALL_PENSION_START_DATE | 2084-07-14 | 2048-07-14 | +36 years |
| RETIRE_DATE | 2055-07-15 | 2048-07-15 | +7 years |
| SHARED_SPENDING | -$600 | -$1,300 | -54% |
| VACATION_SPENDING | -$5,000 | -$10,000 | -50% |

---

## Data Quality Issues in Dev

1. **Invalid end date**: Kendall 401(k) Contribution Raise has end date of 2025-12-31 but starts 2026-05-07 (impossible)
2. **Duplicate transfer bill**: "Transfer from Jake to Costco" appears twice (Bill #1 and Bill #14)
3. **Date inconsistencies**: Many bills have dates adjusted to align with Kendall's quit date

---

## Financial Impact Summary

### Income Changes
- **Lost**: Kendall's City of Raleigh income ($1,440 bi-weekly × 26 = ~$37,440/year)
- **Gained**: New Kendall Paycheck ($1,500 bi-weekly × 26 = $39,000/year)
- **Net income change**: +$1,560/year (slightly higher)
- **But**: Jake must transfer $725/month ($8,700/year) to Kendall

### Retirement Savings Impact
- **Jake 401(k) reduction**: $943 → $300 = -$643/paycheck (-$16,718/year)
- **Kendall 401(k) ends**: Lost contributions after 2025-12-31
- **Extended work period**: +7 years of income (2048 → 2055)

### Spending Reductions
- Vacation: -$5,000/year
- Emergency: -$5,000/year
- Shared: -$8,400/year
- Jake personal: -$2,400/year
- Kendall extra: -$3,420/year
- **Total annual spending cuts**: ~-$24,220/year

### New Expenses (Future)
- 2026 Mortgage: $2,500/month starting 2084 ($30,000/year)
- Down payment: -$30,000 (2084)
- Moving/closing: -$13,000 (2084)

---

## Scenario Interpretation

**Development data models a "Kendall Career Change" scenario:**

### Timeline:
1. **2025-12-31**: Kendall quits City of Raleigh
2. **2026-02-01**: Kendall starts new job ($1,500 bi-weekly)
3. **2026-present**: Reduced spending across all categories
4. **2055-07-15**: Jake retires (7 years later than original plan)
5. **2084**: Purchase new home, sell current home (Blossom)

### Key Assumptions:
- New job pays slightly more but has worse benefits (requires Jake's healthcare coverage)
- Significant lifestyle adjustment with spending cuts
- Extended career to compensate for lost retirement savings
- Future home upgrade planned for much later (2084)

### Financial Strategy:
- Reduce discretionary spending immediately
- Jake supports Kendall financially during transition
- Dramatically reduce retirement contributions
- Work longer to make up for reduced savings period
- Plan major purchases for distant future

**Production data represents the baseline/original plan:**
- Both working until 2048
- Higher standard of living
- Aggressive retirement savings
- Earlier retirement age
- No major life changes planned

---

## Recommendations

If implementing the "Kendall Quits" scenario:

1. **Fix data quality issues**:
   - Remove duplicate "Transfer from Jake to Costco" bill (#14)
   - Fix Kendall 401(k) Contribution Raise end date (should be 2055-07-15, not 2025-12-31)

2. **Review retirement impact**:
   - 68% reduction in Jake's 401(k) contributions significantly impacts retirement
   - Consider if 7-year extension adequately compensates

3. **Verify healthcare costs**:
   - New healthcare adjustment (-$200 bi-weekly = -$5,200/year) seems reasonable
   - Confirm this covers Kendall's lost employer coverage

4. **Evaluate spending cuts**:
   - Total cuts of ~$24k/year may be too aggressive
   - Consider gradual reduction rather than immediate 50% cuts

5. **Review 2084 home purchase plan**:
   - Dates are very far in future (59 years)
   - May want to move these dates earlier or remove entirely

6. **Consider intermediate scenarios**:
   - What if Kendall finds better job in 1-2 years?
   - What if spending can increase after stabilization period?

---

## Generated Data

This comparison was generated by running:
- `extract-bills.js` on both dev and prod `data.json` files
- `extract-variables.js` on both dev and prod `variables.csv` files

**Files analyzed:**
- Dev: `/storage/programs/billsV2Dev/Bills-Node-Server/src/utils/io/data/`
- Prod: `/storage/docker/bills/data/`

**Date of analysis:** 2026-01-16

---
