# Spouse Name Refactor — MC Baseline Results

## Run Parameters
- Seed: 12345
- Simulations: 20
- Batch size: 5
- Date range: 2026-01-01 to 2083-12-31
- Date: 2026-04-05

## Results

### Summary
- Deterministic final year: $7.5M
- Median (50th) final year: $146K
- 5th-95th range final year: -$8.0M to $6.3M
- Full spread final year: $15.4M
- Variance present: YES

### Funded Ratio
- Funded ratio: 60.0%
- Failed simulations: 8/20
- Median failure year: 2070

### Percentile Table (Selected Years)
| Year | 0th | 10th | 25th | 50th | 75th | 90th | 100th |
|------|-----|------|------|------|------|------|-------|
| 2026 | -$43K | -$16K | -$799 | $0 | $0 | $0 | $0 |
| 2030 | -$130K | -$82K | -$20K | +$26K | +$108K | +$237K | +$940K |
| 2035 | -$386K | -$306K | -$59K | +$53K | +$299K | +$615K | +$771K |
| 2040 | -$1.4M | -$670K | -$148K | +$3K | +$491K | +$1.3M | +$1.5M |
| 2045 | -$2.4M | -$774K | -$93K | +$256K | +$898K | +$2.9M | +$2.9M |
| 2050 | -$3.9M | -$2.4M | -$55K | +$851K | +$1.7M | +$2.5M | +$4.5M |
| 2055 | -$5.7M | -$4.3M | -$242K | +$1.2M | +$2.5M | +$3.9M | +$5.8M |
| 2060 | -$5.6M | -$4.1M | -$7K | +$1.4M | +$3.2M | +$8.9M | +$9.0M |
| 2065 | -$6.3M | -$4.8M | +$480K | +$2.0M | +$5.1M | +$11.1M | +$13.8M |
| 2070 | -$7.6M | -$6.1M | -$4.7M | -$1.9M | +$3.7M | +$5.6M | +$9.6M |
| 2075 | -$9.2M | -$8.1M | -$6.4M | -$4.8M | +$125K | +$5.9M | +$7.7M |
| 2080 | -$11.5M | -$10.4M | -$8.1M | -$6.3M | -$5.1M | +$623K | +$6.1M |
| 2083 | -$16.2M | -$15.5M | -$10.2M | -$7.3M | -$6.7M | -$1.2M | -$761K |

## Purpose
After Stage 002 (Engine & Data Migration), re-run with the SAME seed (12345) and parameters. Results must match exactly — any difference indicates the refactor changed calculation behavior.
