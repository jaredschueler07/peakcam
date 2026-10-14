# 07 Financial Model

## What this model is—and is not
The companion workbook models **September 2026 through August 2028**, with separate 6-, 12- and 24-month summaries. It has editable assumptions and three seasonal operating cases. No historical PeakCam users, revenue, bills, bank balances or investment data were retrieved. The model is a scenario tool, not a valuation, tax return, forecast confidence interval or statement of actual accounts.

**The core architectural distinction:** camera bytes loaded directly from third-party image/iframe hosts are not assumed to traverse PeakCam’s server. The reviewed renderer does not proxy, record or archive video. Therefore the present model does not invent video CDN/storage costs. A future proxy/recording feature requires a new rights review and a new bandwidth model. [A01](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/package.json) [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx)

## Vendor facts and planning allowances
Vercel’s September 8, 2026 Flat Rate CDN announcement is relevant: Pro includes 1 million CDN requests and 1 TB transfer; added tiers are $20/month for 10 million requests/50 TB, $100 for 50 million/50 TB and $300 for 150 million/50 TB. This is team-wide capacity, not all compute/product usage. Existing teams must opt into the new plan. The workbook assumes the new tier structure, a $20 one-seat Pro base and no competing team-project consumption; **actual billing settings must be verified**. Hobby is not the commercial plan. [V01](https://vercel.com/pricing) [V02](https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams) [V03](https://vercel.com/docs/limits/fair-use-guidelines)

The $0.001/user variable reserve is an **unquoted planning allowance**, not Vercel’s actual analytics/compute rate. Rights budgets are negotiation reserves, not licenses. Admin includes a small allowance for email/domain/books/security/insurance; the first attorney/formation work is separately included as setup. App stores, database, weather, mapping, AI, authentication and stream storage are **$0 in the present architecture**, not “forgotten expenses.” When a new service is approved, add its actual commercial contract instead of silently assuming a free tier.

## Traffic stages: current architecture, illustrative economics
| Monthly users | Model pageviews | Core tech budget range/month | All-in cash range/month* | Illustrative revenue/month** | Model gross margin** |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 5,500 | $20–$142 | $121–$1,542 | $10 | -610% |
| 10,000 | 55,000 | $21–$160 | $130–$1,560 | $415 | 80% |
| 50,000 | 275,000 | $63–$280 | $190–$1,680 | $1,775 | 91% |
| 100,000 | 550,000 | $98–$380 | $240–$1,780 | $3,900 | 94% |
| 500,000 | 2,750,000 | $434–$1,340 | $720–$2,740 | $16,250 | 95% |


\* All-in ranges are planning envelopes including modest admin and discretionary support/marketing, **excluding founder salary, taxes and major one-time legal/license costs**. They are not vendor quotes or confidence intervals. \** Illustrative revenue assumes accepted affiliates, eligible ad inventory and hypothetical sponsor counts; zero revenue remains possible at every traffic stage. Gross margin uses modeled revenue less direct hosting, rights reserve and payment fees, not total operating profit. It can be negative at low traffic.

### Next 6 / 12 / 24 months
| Case | Horizon | Earned revenue | Operating result before founder pay/tax | Peak cumulative funding needed | Result after $50/hour founder-time sensitivity |
| --- | --- | --- | --- | --- | --- |
| Conservative | 6 months | $92 | $-1,194 | $1,206 | $-25,194 |
| Conservative | 12 months | $176 | $-1,889 | $1,890 | $-49,889 |
| Conservative | 24 months | $1,037 | $-2,734 | $2,736 | $-98,734 |
| Base | 6 months | $2,660 | $-3,007 | $4,428 | $-27,007 |
| Base | 12 months | $4,506 | $-4,273 | $4,428 | $-52,273 |
| Base | 24 months | $29,576 | $12,726 | $4,776 | $-83,274 |
| Breakout | 6 months | $11,693 | $-7,987 | $14,542 | $-31,987 |
| Breakout | 12 months | $21,267 | $-11,246 | $14,542 | $-59,246 |
| Breakout | 24 months | $170,531 | $102,184 | $14,542 | $6,184 |


**Conservative** reaches only 5,000 monthly users in the first winter and 12,000 in the second; virtually no sponsor revenue and very weak affiliate intent. **Base** peaks at 35,000 and then 150,000 users, with 3 and 8 active sponsors at winter peaks; Pro remains zero. **Breakout** reaches 90,000 then 500,000 users, more sponsors and a conditional small paid-user target beginning February 2027. These are ambitious assumed trajectories, not observed baselines or statistically predicted outcomes.

The breakout paid-user line is an **active paid-user target derived from monthly traffic**, not a subscriber cohort/churn model. It must not be presented as validated recurring revenue. Replace it with acquisition, cancellation and renewal cohorts if subscriptions actually launch. Display ads are conditional on approval/quality and excluded below an internal traffic gate; setting net RPM to zero is an important downside test.

## Cash is not earned revenue
The model delays affiliate cash by two months and ad cash by one month; sponsor and monthly premium payments are assumed collected in the same month. Network terms, stay completion, reversals and invoice collection can make timing worse. Peak funding need is the most negative cumulative cash balance, not simply the accounting loss. The fixed payout lags are editable in the workbook.

Standard domestic-card processing uses 2.9% plus $0.30 per modeled sponsor/monthly subscriber charge; the conditional paid subscription also includes a 0.7% Billing assumption. These are not charges on affiliate payouts. Foreign cards, disputes, refunds, tax services, ACH options and other fees need actual agreement review. [V04](https://stripe.com/pricing) [V05](https://stripe.com/billing/pricing)

## Sensitivities that matter more than small SaaS savings
Halve pageviews/user; zero out all display ads; halve commercial click rate; remove two-thirds of sponsors; double the maintenance budget; extend affiliate settlement to 90 days; and hold traffic flat after December. Then rerun funding need. A warm winter or no provider permission can erase most upside. The budget should survive a zero-revenue season without relying on consumer borrowing.

For a hypothetical future video proxy, 100,000 viewers × 10 minutes × 2 Mbps is roughly **15 TB** before retries or multiple streams. That is a unit-conversion illustration, not current PeakCam traffic. Add transcoding, storage, bandwidth, source permissions and abuse controls separately. Do not use the current low-cost static model to justify a video-hosting product.

## Financial operating rule
At each month-end, replace scenarios with actual users, approved commissions, sponsor invoices, cash received and invoices paid. Record owner contributions separately from revenue. Reserve for income/self-employment taxes based on a CPA’s view of your total circumstances; no personal tax rate or account balances have been assumed. Expand spending only when measured contribution and cash runway support it.
