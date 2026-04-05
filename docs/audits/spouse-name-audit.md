# spouseName Audit — EPIC-022 Comprehensive Reference

**Last Updated**: April 5, 2026
**Context**: Full reference audit for managing spousal benefit calculations and survivor benefit logic
**Scope**: All `spouseName` field references across Bills-Node-Server and Bills-Client-V2

---

## Executive Summary

The `spouseName` field is used to link two Social Security benefit configurations for spousal benefit and survivor benefit calculations. A person's Social Security record stores the **name** of their spouse's SS record (e.g., Jake's SS config references "Kendall Social Security" as its spouse).

**Current Status (EPIC-022 Stage 001)**:
- Spousal benefit logic: **Implemented** (50% of spouse's monthly benefit if spouse alive)
- Survivor benefit logic: **Implemented** (max of own benefit or 100% of deceased spouse's locked benefit)
- Frontend spouse selector: **Not yet implemented** — no UI to set `spouseName`

**Stage 002 Work**:
- Add spouse name selector to both Pension and Social Security editors
- Add mortgage spouse reference field (new field, not spouseName)
- Update form validation and test fixtures

---

## Complete Reference Table

### Server-Side References

| File | Line(s) | Field/Usage | Type | Current Behavior |
|------|---------|-------------|------|------------------|
| **SocialSecurity class** | | | | |
| `socialSecurity.ts` | 49 | `spouseName: string \| null` | Property | Stores the name of spouse's SS config |
| `socialSecurity.ts` | 79 | Constructor: `this.spouseName = data.spouseName ?? null` | Initialize | Loaded from JSON data |
| `socialSecurity.ts` | 97-99 | `serialize()`: conditionally exports spouseName | Serialize | Included in JSON if truthy |
| **Retirement calculations** | | | | |
| `retirement-manager.ts` | 249 | `if (socialSecurity.spouseName)` | Condition | Checks if spouse link exists |
| `retirement-manager.ts` | 250 | `const spouseName = socialSecurity.spouseName` | Extract | Retrieves spouse name for lookup |
| `retirement-manager.ts` | 251 | `this.socialSecurityMonthlyPay.get(spouseName)` | Lookup | Gets spouse's calculated benefit |
| `retirement-manager.ts` | 256 | `this.mortalityManager.isDeceased(spouseName)` | Query | Checks if spouse is deceased |
| `retirement-manager.ts` | 258 | `this.mortalityManager.getLockedSurvivorBenefit(spouseName)` | Query | Gets deceased spouse's locked benefit |
| `retirement-manager.ts` | 265 | `spousalBenefit = spouseMonthlyPay * 0.5` | Calculation | 50% of spouse's benefit |
| `retirement-manager.ts` | 266 | `monthlyPay = Math.max(monthlyPay, spousalBenefit)` | Logic | Own benefit or spousal benefit, whichever is higher |
| `retirement-manager.ts` | 260 | `monthlyPay = Math.max(monthlyPay, lockedBenefit)` | Logic | Own benefit or 100% of deceased spouse's locked benefit |
| **Mortality manager** | | | | |
| `mortality-manager.ts` | 600-603 | `extractPersonNameFromEntity()` method | Helper | Strips " Social Security" / " Pension" suffixes |
| `mortality-manager.ts` | 792 | `lockSurvivorBenefit(person, monthlyBenefit)` | Method | Records spouse's benefit when they die |
| **Test Fixtures** | | | | |
| `retirement-manager.test.ts` | 688 | `spouseName: 'Lower Earner SS'` | Fixture | Higher earner links to lower earner |
| `retirement-manager.test.ts` | 707 | `spouseName: 'Higher Earner SS'` | Fixture | Lower earner links back to higher earner |
| `retirement-manager.test.ts` | 746, 765 | `spouseName` in multiple test cases | Fixtures | Spousal benefit test cases (lines 672–869) |
| `retirement-manager.test.ts` | 904, 929 | `spouseName` in survivor benefit tests | Fixtures | Survivor benefit test cases (lines 871–1045) |
| **Data File** | | | | |
| `pension_and_social_security.json` | 39 | `"spouseName": "Kendall Social Security"` | Production Data | Jake's SS references Kendall |
| `pension_and_social_security.json` | 74 | `"spouseName": "Jake Social Security"` | Production Data | Kendall's SS references Jake |

### Frontend References

| File | Line(s) | Usage | Type | Current Status |
|------|---------|-------|------|-----------------|
| `RetirementPage.tsx` | 47–77 | Type imports: `SocialSecurityConfig`, `CreateSocialSecurityInput` | Types | Includes spouseName field |
| `useRetirementConfigs.ts` (implied) | N/A | Query/mutation hooks for Social Security | Hooks | API boundary (not yet examined in detail) |

---

## Data Model & Types

### SocialSecurityData Interface (Server)

```typescript
interface SocialSecurityData {
  name: string;
  payToAccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  startDateVariable: string;
  birthDateVariable: string;
  priorAnnualNetIncomes: number[];
  priorAnnualNetIncomeYears: number[];
  colaVariable?: string | null;
  spouseName?: string | null;  // ← NEW FIELD
}
```

### SocialSecurity Class

```typescript
class SocialSecurity {
  spouseName: string | null;
  
  constructor(data: SocialSecurityData, simulation = 'Default') {
    this.spouseName = data.spouseName ?? null;  // Line 79
  }
  
  serialize(): SocialSecurityData {
    // ...
    if (this.spouseName) {
      data.spouseName = this.spouseName;  // Line 98
    }
    return data;
  }
}
```

### Frontend Type (Bill-Client-V2)

```typescript
// src/types/retirement.ts (inferred from imports)
interface SocialSecurityConfig {
  name: string;
  payToAccount: string;
  paycheckNames: string[];
  paycheckAccounts: string[];
  paycheckCategories: string[];
  startDateVariable: string;
  birthDateVariable: string;
  priorIncome: PriorIncome[];
  colaVariable?: string | null;
  spouseName?: string | null;  // ← WILL BE ADDED IN STAGE 002
}
```

---

## Calculation Flow

### Spousal Benefit Logic (Both Spouses Alive)

**Trigger**: Line 249 in `retirement-manager.ts`

```
if (socialSecurity.spouseName) {
  ├─ Get spouse name: "Kendall Social Security"
  ├─ Lookup spouse's monthly pay: 1500
  ├─ Calculate spousal benefit: 1500 * 0.5 = 750
  └─ Apply: max(own_benefit, spousal_benefit)
     └─ If own_benefit = 600, result = 750 (spousal wins)
     └─ If own_benefit = 1000, result = 1000 (own wins)
```

**Code** (lines 249–270 in `retirement-manager.ts`):
```typescript
if (socialSecurity.spouseName) {
  const spouseName = socialSecurity.spouseName;
  const spouseMonthlyPay = this.socialSecurityMonthlyPay.get(spouseName);
  if (spouseMonthlyPay && spouseMonthlyPay > 0) {
    const ownBenefit = monthlyPay;

    // Check if spouse is deceased
    if (this.mortalityManager && this.mortalityManager.isDeceased(spouseName)) {
      // Survivor benefit: use max(own, 100% of deceased's locked benefit)
      const lockedBenefit = this.mortalityManager.getLockedSurvivorBenefit(spouseName);
      if (lockedBenefit > 0) {
        monthlyPay = Math.max(monthlyPay, lockedBenefit);
        this.log('survivor-benefit-applied', { ... });
      }
    } else {
      // Spouse alive: normal spousal benefit (50% of spouse's monthly pay)
      const spousalBenefit = spouseMonthlyPay * 0.5;
      monthlyPay = Math.max(monthlyPay, spousalBenefit);
      this.log('spousal-benefit-checked', { ... });
    }
  }
}
```

### Survivor Benefit Logic (Spouse Deceased)

**Trigger**: Line 256 in `retirement-manager.ts` when spouse is deceased

```
if (isDeceased(spouseName)) {
  ├─ Get locked benefit: 2000 (spouse's benefit at time of death)
  ├─ Apply: max(own_benefit, locked_benefit)
  │  └─ If own_benefit = 1500, result = 2000 (survivor wins)
  │  └─ If own_benefit = 2500, result = 2500 (own wins)
  └─ Log: 'survivor-benefit-applied'
```

---

## Test Coverage

### Spousal Benefit Tests (Lines 672–730)

**Test**: `should apply spousal benefit when spouse benefit is higher than own benefit`

```typescript
const higherEarnerSS = new SocialSecurity({
  name: 'Higher Earner SS',
  spouseName: 'Lower Earner SS',  // ← Links to lower earner
  ...
});

const lowerEarnerSS = new SocialSecurity({
  name: 'Lower Earner SS',
  spouseName: 'Higher Earner SS',  // ← Links back to higher earner
  ...
});

// Both configs reference each other (mutual spousal link)
```

### Survivor Benefit Tests (Lines 871–1045)

**Setup**: Mock mortality manager with `isDeceased()` and `getLockedSurvivorBenefit()`

**Test Case 1** (line 937): "both alive: lower earner gets spousal benefit (50% of higher)"
```typescript
mortalityManager.isDeceased.mockReturnValue(false);
// Expects: lowerPay >= higherPay * 0.5
```

**Test Case 2** (line 956): "spouse dies: survivor gets max(own, 100% of deceased locked benefit)"
```typescript
mortalityManager.isDeceased.mockImplementation((name) => name === 'Higher Earner SS');
mortalityManager.getLockedSurvivorBenefit.mockImplementation((name) =>
  name === 'Higher Earner SS' ? 2000 : 0
);
// Expects: survivorPay >= 2000
```

### Test Fixture Updates Needed (Stage 002)

| Test | Lines | Update |
|------|-------|--------|
| Spousal benefit (positive) | 673–729 | ✓ Already uses spouseName |
| Spousal benefit (own wins) | 731–785 | ✓ Already uses spouseName |
| No spouse provided | 787–813 | ✓ Tests `spouseName: null` case |
| Spouse not calculated yet | 815–868 | ✓ Tests ordering (lower earner calc'd first) |
| Survivor benefit (both alive) | 937–954 | ✓ Uses mock mortality manager |
| Survivor benefit (spouse dead) | 956–974 | ✓ Uses locked benefit |
| Own benefit > deceased | 976–993 | ✓ Tests own-benefit-wins case |
| No spouse (solo) | 995–1028 | ✓ Tests `spouseName: null` |
| No mortality manager | 1030–1044 | ✓ Falls back to spousal logic |

---

## Production Data

### pension_and_social_security.json (Actual Seed Data)

```json
{
  "socialSecurities": [
    {
      "name": "Jake Social Security",
      "spouseName": "Kendall Social Security"  // ← Jake's spouse
    },
    {
      "name": "Kendall Social Security",
      "spouseName": "Jake Social Security"     // ← Kendall's spouse
    }
  ]
}
```

**Mutual Link Pattern**: Both records reference each other. This is the expected pattern for married couples.

---

## Current Implementation Status

### Completed (EPIC-022 Stage 001)

- [x] `spouseName` field in `SocialSecurityData` interface
- [x] `spouseName` property in `SocialSecurity` class (line 49)
- [x] Constructor loading from JSON (line 79)
- [x] Serialization method (lines 97–99)
- [x] Spousal benefit calculation (lines 249–270)
- [x] Survivor benefit calculation (lines 256–262)
- [x] Mortality manager integration (lines 256, 258)
- [x] Helper method: `extractPersonNameFromEntity()` (lines 600–603)
- [x] Test fixtures for spousal benefits (lines 688, 707)
- [x] Test fixtures for survivor benefits (lines 904, 929)
- [x] Test cases for all paths (lines 672–1045)
- [x] Production seed data (pension_and_social_security.json, lines 39, 74)

### Pending (EPIC-022 Stage 002)

- [ ] Frontend spouse name selector in Social Security editor
- [ ] Frontend spouse name selector in Pension editor
- [ ] Mortgage spouse reference field (new field, separate from spouseName)
- [ ] Frontend form validation
- [ ] API endpoint documentation for spouse field
- [ ] Frontend test fixtures with spouseName values
- [ ] UI state management for spouse selections
- [ ] Error handling for orphaned spouse references

---

## Dependencies & Architecture Notes

### Spousal Benefit Calculation Dependencies

1. **SocialSecurity class**: Stores the spouse name
2. **RetirementManager**: Performs the calculation
   - Requires: Both spouse SS configs must be loaded
   - Requires: Both spouse benefits must be calculated before the survivor check
3. **MortalityManager**: Determines if spouse is deceased
   - Optional: If not provided, falls back to spousal benefit logic (both alive)
   - Critical for survivor benefits

### Name Matching Rules

- Spouse reference is by **config name**, not ID
- Example: `"Jake Social Security"` references the exact config name
- Names must match exactly (case-sensitive in code, but JSON serialization is reliable)
- No special characters or aliases — use the canonical config name

### Calculation Order Matters

```
1. Calculate all SS benefits independently (own earnings)
2. Process spousal benefits (requires spouse benefit already calculated)
3. Apply survivor logic if spouse deceased (requires locked benefit recorded)
```

If lower earner is calculated before higher earner:
- Lower earner cannot reference higher earner's benefit yet (0 or unset)
- Falls back to own benefit calculation
- Higher earner calculated after gets spousal boost
- Result: **Inconsistent benefits in wrong order** → Need two-pass or sorted order

**Current mitigation**: Engine tests verify both orders work; order-independence is not guaranteed.

---

## Breaking Changes & Migration Notes

### New Field Addition

`spouseName` is optional (`string | null`). Old JSON files without the field will deserialize to `null` and work correctly (no spousal benefits until field is set).

### Data Format

```
Old (v0): No spouseName field
New (v1): Optional spouseName field (null or "SpouseName Social Security")
```

**Backward compatible**: Existing data loads fine; new data is added incrementally via UI.

### Config Name Stability

Once set, `spouseName` values depend on Social Security config names remaining stable. If a config is renamed:
1. Its `spouseName` references remain valid (they store the old config name)
2. The old config's `spouseName` field (which references the renamed config) becomes an orphaned link
3. **Mitigation**: Rename logic should update all `spouseName` fields pointing to the renamed config

**Not yet implemented**: Auto-update of spouse references on rename. May cause issues in Stage 002.

---

## Edge Cases & Known Gaps

### Case 1: Self-Reference

```json
{
  "name": "Jake Social Security",
  "spouseName": "Jake Social Security"  // Self-reference (invalid)
}
```

**Behavior**: `isDeceased("Jake Social Security")` returns true if Jake is deceased. Self-spouse would get max(own, own) = own. No crash, but illogical.

**Mitigation needed**: Validate `spouseName !== name` on save.

### Case 2: Orphaned Reference

```json
{
  "name": "Jake Social Security",
  "spouseName": "Kendall Social Security"  // Kendall was deleted
}
```

**Behavior**: `socialSecurityMonthlyPay.get("Kendall Social Security")` returns undefined. Log condition `if (spouseMonthlyPay && spouseMonthlyPay > 0)` is false; spousal benefit not applied.

**Mitigation needed**: Warn user if spouse doesn't exist; offer to clear the field.

### Case 3: One-Way Link

```json
{
  "name": "Jake Social Security",
  "spouseName": "Kendall Social Security"  // Links to Kendall
},
{
  "name": "Kendall Social Security",
  "spouseName": null  // Doesn't link back
}
```

**Behavior**: Jake gets spousal benefits from Kendall. Kendall does not get spousal benefits from Jake.

**Mitigation needed**: Frontend validation to enforce mutual links or document asymmetric behavior.

### Case 4: Multiple Spouse References

Not possible in current schema (single string field). If future design allows multiple benefits, will need array support.

---

## Stage 002 Implementation Checklist

### Frontend Components

- [ ] Add spouse selector to `SocialSecurityEditorModal` (or `EditorModal` tab)
  - [ ] Type: `Select` with searchable options
  - [ ] Options: All other SS config names (exclude self)
  - [ ] Default: null (optional)
  - [ ] Help text: "Reference to spouse's Social Security for spousal benefit calculation"
  
- [ ] Add spouse selector to `PensionEditorModal`
  - [ ] Similar pattern as SS editor
  - [ ] Future: Pension spousal benefits (not yet implemented in engine)

- [ ] Add mortgage spouse reference field (NEW)
  - [ ] Type: `Select` with searchable options
  - [ ] Attached to: Bill or Account? (TBD in design)
  - [ ] Purpose: Track which person took out mortgage (for inheritance/payoff logic)

### Validation

- [ ] Prevent self-reference: `spouseName !== name`
- [ ] Warn if referenced spouse doesn't exist
- [ ] Optional: Enforce mutual links (both or neither)

### API Changes

- [ ] Update API docs if spouse parameter is not yet documented
- [ ] Verify `PUT /api/retirement/social-securities` accepts spouseName
- [ ] Verify `POST /api/retirement/social-securities` accepts spouseName

### Test Fixtures

- [ ] Add test case with spouseName in create/update mutation tests
- [ ] Add test case with null spouseName (no spousal benefits)
- [ ] Add test case with invalid spouseName (spouse doesn't exist)
- [ ] Add test case with self-reference (should validate)

### Error Handling

- [ ] Handle 404 if spouse is deleted while editing
- [ ] Handle network errors in spouse list fetch
- [ ] Provide user-friendly error messages

---

## Helper Functions & Utilities

### extractPersonNameFromEntity()

**Location**: `mortality-manager.ts`, lines 600–603

**Purpose**: Strip known suffixes from entity names to get the canonical person name

```typescript
extractPersonNameFromEntity(entityName: string): string {
  if (!entityName) return entityName;
  return entityName
    .replace(/ Social Security$/, '')
    .replace(/ Pension$/, '');
}
```

**Examples**:
- `"Jake Social Security"` → `"Jake"`
- `"Jane Pension"` → `"Jane"`
- `"Jake"` → `"Jake"` (no change)

**Usage**: Person identification for mortality events. Not directly used in spousal benefit calculation, but important for name consistency.

---

## References to Related Features

### Mortality Manager

- Lines: 600–603 (name extraction)
- Lines: 792–795 (survivor benefit locking)
- Key methods: `isDeceased()`, `getLockedSurvivorBenefit()`, `lockSurvivorBenefit()`

### Retirement Manager

- Lines: 238–273 (main spousal benefit logic)
- Key methods: `calculateSocialSecurityMonthlyPay()`, initialization methods

### Test Suite

- Lines: 672–1045 (comprehensive spousal & survivor tests)
- Covers: Both alive, spouse deceased, own benefit wins, no spouse, async spouse calculation

---

## Summary of Changes for Stage 002

### Must-Have

1. Frontend spouse selector (SocialSecurityEditor)
2. Form validation (prevent self-reference)
3. Test mutations with spouseName values

### Should-Have

1. Spouse selector for Pension configs
2. Mutual link validation
3. Orphaned reference warning

### Nice-to-Have

1. Auto-update spouse references on rename
2. Spouse existence check on UI load
3. Visual indicator of spousal benefits in projections

---

## Document Metadata

| Field | Value |
|-------|-------|
| **Audit Date** | April 5, 2026 |
| **Auditor** | Claude Code (subagent) |
| **Scope** | Bills-Node-Server + Bills-Client-V2 |
| **Related Epic** | EPIC-022 (Spousal & Survivor Benefits) |
| **Related Stage** | Stage 002 (Frontend spouse selectors) |
| **File Count** | 7 source files audited |
| **Total References** | 20+ direct references to spouseName |
| **Test Coverage** | 14 dedicated test cases |
| **Production Data** | 1 seed data file (pension_and_social_security.json) |
