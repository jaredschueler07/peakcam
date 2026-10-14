# Financial model readiness review

September 13, 2026. Original workbook and CSV/JSON files are unchanged. This review assesses the supplied business scenario; it is not actual bookkeeping or a vendor quote.

## What was checked

Read both XLSX files using Artifact Tool. The financial workbook has 13 sheets; the CRM has 6. The imported formula-error scan found no `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#NUM!` or `#NULL!` matches. All numeric fields in the 72 monthly financial rows agree with the JSON snapshot within `1e-6`; all nine 6/12/24-month summaries reconcile to the monthly records. This checks saved/imported calculations, not every formula’s response to edited inputs or native Excel rendering/recalculation.

Trace example: `Summary!C6:H6` summarizes the first 12 Base months. Revenue uses `Base!P2:P13`; operating result uses `Base!AB2:AB13`; peak funding is the maximum shortfall in `Base!AF2:AF13`. Base revenue is affiliate + ads + sponsors + premium. Affiliate revenue uses traffic, click rate, conversion, commission and approval assumptions from `Case Inputs` and `Inputs`; cash lags are separate.

## Reconciled original base case

| First 12 months, September 2026–August 2027 | USD |
|---|---:|
| Affiliate revenue | 1,255.00 |
| Display-ad revenue | 1,600.50 |
| Sponsor revenue | 1,650.00 |
| Premium revenue | 0.00 |
| Total earned revenue | 4,505.50 |
| Operating result before founder pay/tax | (4,273.15) |
| Peak cumulative cash funding needed | 4,427.95 |
| Marketing spending | 2,600.00 |
| Contractor spending | 2,000.00 |
| Setup spending | 2,000.00 |

These are original assumptions and outputs, not received money or authorized spending. The scenario assumes 500 September monthly users growing to 35,000 at the first winter peak. Auth/subscriber counts do not validate that traffic path.

## Decisions to resolve before using it as a budget

1. **Architecture:** the model’s explicit $0 database/maps/auth/weather treatment describes the old static directory. Current production uses Supabase, MapTiler integration, PostHog, Resend, Open-Meteo, server routes and game assets. Collect real invoices and metering rather than replacing zero with guessed bills. Separate game traffic and any dormant services from the camera pilot where meaningful.
2. **Advertising:** the original base assumes $1,600.50 first-year display revenue; the July product roadmap rejects programmatic ads. Until Jared makes a deliberate decision, use the no-ads sensitivity for planning. It is materially less funded by revenue.
3. **Marketing envelope:** the model spends $2,600 in year one; the executive recommendation starts with a $500–$1,000 seasonal envelope. Choose one approved envelope, map categories to months, and re-run cash. Do not add the roadmap’s $2,800 or experiment allowances on top of modeled spending without checking overlap.
4. **Premium unit:** the workbook assumes $4.99 per active paid user per month, while the concept test proposes $19–29 per season. Choose a researched offer before implementing billing. A seasonal pass requires a different cash/earned schedule and renewal model; multiplying paid target by monthly price is not a subscriber cohort forecast.
5. **Timing:** affiliate cash is modeled two months after earned revenue, ads after one. Partner invoice cash is immediate. Replace these with agreed payout/completed-stay/return terms when accepted; include delayed or unpaid sponsor invoices.
6. **Capacity:** 80 founder hours/month is about 18.5 hours/week over a year, not exactly 20. Use real calendar capacity and holidays. The $50/hour founder sensitivity is opportunity cost, not salary paid. A profitable-before-founder scenario can still fail to compensate the work.
7. **CDN:** the dated Vercel Flat Rate CDN announcement supports the supplied tier structure, but team selection and actual usage are separate facts. The team is Pro; Flat Rate CDN adoption and the actual invoice were not verified. The workbook’s upgrade formula keys on request count, not transfer limits; stress transfer separately if game/assets materially change bytes per page. [Vercel announcement](https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams)
8. **Weather:** Open-Meteo’s free hosted endpoint excludes commercial use. Get actual commercial access costs and confirm metering of variables, locations and lookback; keep attribution. Do not presume an API key alone resolves every display/caching use. [Open-Meteo pricing and usage](https://open-meteo.com/en/pricing)

## Illustrative sensitivity, holding original traffic and spending

| Scenario | Earned revenue, 12 months | Operating result | Peak funding need |
|---|---:|---:|---:|
| Original Base | $4,505.50 | ($4,273.15) | $4,427.95 |
| No display ads | $2,905.00 | ($5,873.65) | $5,928.65 |
| No ads + hypothetical $100/month services | $2,905.00 | ($7,073.65) | $7,128.65 |
| No ads + hypothetical $250/month services | $2,905.00 | ($8,873.65) | $8,928.65 |
| Zero revenue, original spending retained | $0.00 | ($8,727.50) | $8,727.50 |

Method: remove ad earned revenue in its original month and ad receipts one month later. Add the stated service allowance to every month’s cash outflow. For zero revenue, remove all receipts/revenue and associated modeled payment fees while retaining all other original spending. Recalculate cumulative cash and its largest shortfall. Taxes and founder pay remain excluded. Additional-service lines are hypothetical sensitivities, not vendor prices. See [CSV](Financial_Stress_Scenarios.csv).

The no-ads case already exceeds the provisional $3,000–$5,000 cash-at-risk envelope. **Reduce spending or revise the agreed funding limit before relying on it.** The zero-revenue row is a stress test; a gated plan should stop or defer discretionary spending before reaching that exposure.

## Actuals and budget handoff: C02

Populate [Operating_Cost_Inputs.csv](Operating_Cost_Inputs.csv) with the prior two invoices and current commitment for each active service. Use a restricted ledger for transaction detail. Keep one-time setup, recurring cost, optional experiments and unspent reserve distinct. Record owner contributions separately from revenue; gross bookings, commissions earned, commissions reversed and cash received are different fields.

Rebase the workbook only after these inputs and pricing/ads decisions are known. Preserve the September 9 copy, use one identified working model, re-run the nine horizon summaries, check zero traffic/revenue, missing inputs, settlement delays, price unit and extra cost boundaries, then regenerate clearly dated exports. Never silently describe the old exports as live after a workbook edit.

A weekly cash check needs opening business cash, unpaid committed costs, cash collected, bills paid and remaining discretionary authorization. Release the next experiment budget only when its prerequisite evidence exists. Any choice of entity, taxes, insurance or filings requires Jared’s actual operating circumstances and the relevant professional review; this packet does not make those choices.
