# Log Registry

Generated: 2026-03-18T13:12:03.283Z

Total log points: 147

| Component | Event | File | Line | Fields |
|-----------|-------|------|------|--------|
| aca | aca-person-premium | aca-manager.ts | 144 | age, year, premium |
| aca | benchmark-inflated | aca-manager.ts | 129 | year, latest_year, inflated_premium |
| aca | cobra-premium-calculated | aca-manager.ts | 74 | year, premium |
| aca | cobra-premium-calculated | aca-manager.ts | 85 | year, premium |
| aca | couple-premium-calculated | aca-manager.ts | 166 | age1, age2, year, premium1, premium2, total |
| aca | net-premium-calculated | aca-manager.ts | 278 | gross_premium, subsidy, net_premium |
| aca | person-skipped-medicare | aca-manager.ts | 158 | age, year, reason |
| aca | person-skipped-medicare | aca-manager.ts | 161 | age, year, reason |
| aca | subsidy-calculated | aca-manager.ts | 243 | magi, household_size, year, fpl, fpl_percent, subsidy |
| aca | subsidy-calculated | aca-manager.ts | 255 | magi, household_size, year, fpl, fpl_percent, subsidy |
| aca | subsidy-tier | aca-manager.ts | 239 | fpl_percent, tier, expected_contribution_pct |
| balance-tracker | balance-range-calculated | balance-tracker.ts | 265 | accountId, min, max |
| balance-tracker | balances-initialized | balance-tracker.ts | 56 | accountCount, startDate |
| balance-tracker | segment-applied | balance-tracker.ts | 182 | balanceChangesCount, activitiesAddedCount |
| balance-tracker | snapshot-created | balance-tracker.ts | 103 | date, accountCount |
| balance-tracker | snapshot-restored | balance-tracker.ts | 128 | snapshotDate, accountCount |
| calculator | aca-premium-processed | calculator.ts | 1465 | person, monthlyPremium, priorMAGI, isCobraPeriod |
| calculator | activity-processed | calculator.ts | 144 | name, accountId, amount |
| calculator | bill-processed | calculator.ts | 302 | name, accountId, amount, isHealthcare |
| calculator | contribution-capped | calculator.ts | 1295 | from, to, requestedAmount, cappedAmount |
| calculator | expense-ratio-applied | calculator.ts | 388 | accountId, baseApr, expenseRatio, adjustedApr |
| calculator | healthcare-bill-routed | calculator.ts | 153 | name, person |
| calculator | healthcare-bill-routed | calculator.ts | 281 | name, person |
| calculator | healthcare-patient-cost | calculator.ts | 175 | name, billAmount, patientCost, configName |
| calculator | healthcare-patient-cost | calculator.ts | 339 | name, billAmount, patientCost, configName |
| calculator | hsa-reimbursement | calculator.ts | 223 | hsaAccountId, reimbursementAmount, patientCost |
| calculator | interest-calculated | calculator.ts | 429 | accountId, balance, apr, amount |
| calculator | loan-limit-applied | calculator.ts | 516 | accountId, requestedAmount, limitedAmount |
| calculator | ltc-check-processed | calculator.ts | 1548 | person, netCost, accountId |
| calculator | medicare-premium-processed | calculator.ts | 1335 | person, totalCost, accountId |
| calculator | pension-processed | calculator.ts | 728 | name, accountId, amount |
| calculator | rmd-processed | calculator.ts | 878 | accountId, rmdAmount, priorYearBalance |
| calculator | roth-conversion-processed | calculator.ts | 948 | conversionsCount, totalAmount |
| calculator | spending-tracker-processed | calculator.ts | 1029 | categoryId, amount |
| calculator | ss-processed | calculator.ts | 794 | name, accountId, amount |
| calculator | tax-event-processed | calculator.ts | 820 | year, totalTax, autoCalculatedTax |
| calculator | transfer-processed | calculator.ts | 659 | from, to, amount, name |
| calculator | variable-amount-resolved | calculator.ts | 497 | resolution, amount |
| contribution-limit | base-limit-with-catchup | contribution-limit-manager.ts | 157 | limit_type, year, age, base_limit, catchup_eligible, total_limit |
| contribution-limit | base-limit-with-catchup | contribution-limit-manager.ts | 173 | limit_type, year, age, base_limit, catchup_eligible, total_limit |
| contribution-limit | base-limit-with-catchup | contribution-limit-manager.ts | 186 | limit_type, year, age, base_limit, catchup_eligible, total_limit |
| contribution-limit | base-limit-with-catchup | contribution-limit-manager.ts | 193 | limit_type, year, age, base_limit, catchup_eligible, total_limit |
| contribution-limit | base-limit-with-catchup | contribution-limit-manager.ts | 200 | limit_type, year, age, base_limit, catchup_eligible, total_limit |
| contribution-limit | contribution-recorded | contribution-limit-manager.ts | 300 | person, year, limit_type, amount, new_total |
| contribution-limit | historical-limit-loaded | contribution-limit-manager.ts | 111 | limit_type, year, limit |
| contribution-limit | limit-inflated | contribution-limit-manager.ts | 125 | limit_type, year, base_limit, inflated_limit |
| contribution-limit | remaining-limit-checked | contribution-limit-manager.ts | 237 | person, year, limit_type, total_limit, contributed, remaining |
| contribution-limit | remaining-limit-checked | contribution-limit-manager.ts | 243 | person, year, limit_type, total_limit, contributed, remaining |
| contribution-limit | remaining-limit-checked | contribution-limit-manager.ts | 249 | person, year, limit_type, total_limit, contributed, remaining |
| engine | cache-check | engine.ts | 88 | cacheHit |
| engine | cache-check | engine.ts | 92 | cacheHit |
| engine | calculation-completed | engine.ts | 118 | durationMs |
| engine | calculation-started | engine.ts | 76 | simulation, startDate, endDate, monteCarlo, forceRecalculation |
| engine | components-initialized | engine.ts | 383 | (none) |
| engine | tax-config-loaded | engine.ts | 206 | filingStatus, withdrawalStrategy |
| engine | timeline-created | engine.ts | 243 | eventCount |
| healthcare | active-plan-selected | healthcare-manager.ts | 171 | person, date, config_name |
| healthcare | config-resolved | healthcare-manager.ts | 81 | config_name, start_date, end_date |
| healthcare | copay-calculated | healthcare-manager.ts | 385 | copay_amount, bill_amount, patient_cost |
| healthcare | deductible-calculated | healthcare-manager.ts | 449 | deductible_remaining, bill_amount, coinsurance_pct, patient_cost |
| healthcare | deductible-inflated | healthcare-manager.ts | 95 | config_name, base_year, current_year, base_deductible, inflated_deductible |
| healthcare | deductible-progress | healthcare-manager.ts | 315 | person, spent, inflated_limit, remaining, met |
| healthcare | expense-recorded | healthcare-manager.ts | 268 | person, amount, toward_deductible, toward_oop |
| healthcare | no-plan-found | healthcare-manager.ts | 160 | person, date |
| healthcare | oop-max-reached | healthcare-manager.ts | 441 | config_name, oop_spent, oop_max |
| healthcare | oop-progress | healthcare-manager.ts | 357 | person, spent, inflated_limit, remaining, met |
| healthcare | patient-cost-cached | healthcare-manager.ts | 488 | expense_key, patient_cost |
| healthcare | plan-year-reset | healthcare-manager.ts | 243 | config_name, plan_year |
| ltc | age-band-determined | ltc-manager.ts | 171 | person, age, age_band |
| ltc | benefit-pool-used | ltc-manager.ts | 366 | person, cost, benefit_applied, pool_remaining |
| ltc | cost-factor-set | ltc-manager.ts | 219 | person, cost_factor |
| ltc | cost-factor-set | ltc-manager.ts | 231 | person, cost_factor |
| ltc | cost-factor-set | ltc-manager.ts | 243 | person, cost_factor |
| ltc | elimination-tracked | ltc-manager.ts | 319 | person, remaining_days |
| ltc | episode-started | ltc-manager.ts | 226 | person, state, episode_count |
| ltc | episode-started | ltc-manager.ts | 238 | person, state, episode_count |
| ltc | episode-started | ltc-manager.ts | 250 | person, state, episode_count |
| ltc | monthly-step | ltc-manager.ts | 175 | person, age, current_state, month |
| ltc | person-initialized | ltc-manager.ts | 121 | person, benefit_pool, daily_benefit_cap |
| ltc | state-transition | ltc-manager.ts | 225 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 237 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 249 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 265 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 270 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 274 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 278 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 292 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 297 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 301 | person, from_state, to_state, probability |
| ltc | state-transition | ltc-manager.ts | 310 | person, from_state, to_state, probability |
| medicare | change-ratio-used | medicare-manager.ts | 113 | year, ratio, value |
| medicare | fallback-inflation | medicare-manager.ts | 118 | year, inflation_rate, value |
| medicare | irmaa-bracket-matched | medicare-manager.ts | 179 | magi, filing_status, year, tier, part_b_surcharge, part_d_surcharge |
| medicare | part-b-premium | medicare-manager.ts | 205 | year, premium |
| medicare | part-d-premium | medicare-manager.ts | 215 | year, premium |
| medicare | value-projected | medicare-manager.ts | 123 | field, year, latest_year, projected_value |
| push-pull | pull-cascade | push-pull-handler.ts | 209 | exhausted_account, remaining_deficit |
| push-pull | pull-cascade | push-pull-handler.ts | 265 | exhausted_account, remaining_deficit |
| push-pull | pull-executed | push-pull-handler.ts | 256 | from_account, to_account, amount, committed_total |
| push-pull | pull-failure | push-pull-handler.ts | 278 | account, requested, shortfall |
| push-pull | pull-needed | push-pull-handler.ts | 90 | account, balance, minimum_balance, deficit |
| push-pull | push-executed | push-pull-handler.ts | 165 | from_account, to_account, amount |
| push-pull | push-needed | push-pull-handler.ts | 82 | account, balance, maximum_balance, push_amount |
| push-pull | roth-penalty-checked | push-pull-handler.ts | 312 | account, withdrawal_amount, penaltyable_balance, penalty_amount, age_check_passed |
| push-pull | roth-penalty-checked | push-pull-handler.ts | 334 | account, withdrawal_amount, penaltyable_balance, penalty_amount, age_check_passed |
| push-pull | source-selected | push-pull-handler.ts | 201 | source_account, available_balance, priority |
| retirement | aime-calculated | retirement-manager.ts | 271 | name, aime |
| retirement | fra-determined | retirement-manager.ts | 399 | birth_year, fra_years, fra_months |
| retirement | indexed-earnings | retirement-manager.ts | 282 | year, raw_earnings, indexed_earnings |
| retirement | indexed-earnings | retirement-manager.ts | 287 | year, raw_earnings, indexed_earnings |
| retirement | pension-initialized | retirement-manager.ts | 145 | name, year_count |
| retirement | pension-monthly-calculated | retirement-manager.ts | 225 | name, monthly_pay, avg_compensation, years_worked |
| retirement | pia-computed | retirement-manager.ts | 362 | name, aime, bend1, bend2, pia |
| retirement | spousal-benefit-checked | retirement-manager.ts | 214 | name, own_benefit, spousal_benefit, result |
| retirement | ss-initialized | retirement-manager.ts | 125 | name, year_count |
| retirement | ss-monthly-calculated | retirement-manager.ts | 202 | name, monthly_pay, collection_age, factor |
| retirement | wage-base-capped | retirement-manager.ts | 173 | year, total_income, wage_base_cap, capped_income |
| roth-conversion | aca-subsidy-checked | roth-conversion-manager.ts | 262 | next_year, current_magi, subsidy_before, subsidy_after, annual_loss, effective_rate |
| roth-conversion | account-lookup | roth-conversion-manager.ts | 119 | source, destination, source_found, dest_found |
| roth-conversion | bracket-space-calculated | roth-conversion-manager.ts | 154 | year, ordinary_income, standard_deduction, taxable_income, target_bracket, remaining_space |
| roth-conversion | conversion-amount-set | roth-conversion-manager.ts | 182 | source_balance, bracket_space, conversion_amount |
| roth-conversion | conversion-completed | roth-conversion-manager.ts | 332 | year, source, destination, amount |
| roth-conversion | insufficient-space | roth-conversion-manager.ts | 165 | year, taxable_income, target_bracket, reason |
| roth-conversion | lot-recorded | roth-conversion-manager.ts | 317 | destination, amount, year, penalty_free_year |
| roth-conversion | prior-cleared | roth-conversion-manager.ts | 95 | year |
| roth-conversion | processing-started | roth-conversion-manager.ts | 87 | year, config_count |
| roth-conversion | window-check | roth-conversion-manager.ts | 111 | year, start_year, end_year, in_window |
| segment | cache-hit | segment-processor.ts | 93 | startDate, endDate |
| segment | day-events-processed | segment-processor.ts | 298 | date, eventCount, balanceChangesCount |
| segment | healthcare-state-restored | segment-processor.ts | 123 | activitiesReprocessed |
| segment | push-pull-executed | segment-processor.ts | 155 | eventsAdded |
| segment | segment-reprocessed | segment-processor.ts | 159 | reason |
| segment | segment-started | segment-processor.ts | 83 | startDate, endDate, eventCount |
| segment | taxable-occurrence-routed | segment-processor.ts | 190 | accountName, amount, incomeType, year |
| tax | annual-tax-calculated | tax-manager.ts | 115 | year, taxable_income, total_tax, effective_rate |
| tax | cache-invalidated | tax-manager.ts | 134 | account, year |
| tax | income-aggregated | tax-manager.ts | 97 | year, ordinary_income, ss_income, penalty_total |
| tax | occurrence-added | tax-manager.ts | 41 | account, year, amount, income_type |
| tax | ss-taxation-computed | tax-manager.ts | 112 | year, ss_income, provisional_income, taxable_ss, tier |
| timeline | aca-events-added | timeline.ts | 553 | count |
| timeline | activity-events-added | timeline.ts | 215 | count |
| timeline | bill-events-added | timeline.ts | 228 | count |
| timeline | interest-events-added | timeline.ts | 239 | count |
| timeline | mc-applied | timeline.ts | 134 | eventsModified |
| timeline | medicare-events-added | timeline.ts | 421 | count |
| timeline | roth-events-added | timeline.ts | 359 | count |
| timeline | tax-events-added | timeline.ts | 346 | count |
