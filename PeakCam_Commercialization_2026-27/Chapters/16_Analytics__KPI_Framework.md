# 16 Analytics & KPI Framework

## North Star
**Weekly returning camera decision-makers:** consent-aware, non-bot visitors who complete a qualified camera action on at least two distinct days in a rolling 28-day period, with at least one action in the current week. A qualified action is a deliberate click to the correct official camera source or a confirmed provider playback event where that can actually be measured. The definition is a proposed operational metric, not a claim that the current analytics supports it out of the box.

The observed `camera_watch_open` is intent; `camera_embed_ready` from iframe onLoad is a technical load signal. Neither alone establishes a valid live view. Use these to diagnose the funnel, not to inflate a sponsor’s “video views.” [A03](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/components/cams/CamEmbed.tsx) [A04](https://github.com/jaredschueler07/peakcam/blob/61c5f264a6e16c827ff2a7a8654dd6d5a07e809d/app/layout.tsx)

| Funnel step | Proposed range / interpretation | Metric |
| --- | --- | --- |
| Impression → visitor | Channel-specific; no universal forecast. For search, inspect actual query CTR | UTM/search clicks divided by valid impressions where measurable |
| Visitor → engaged | 35–60% initial target, not industry benchmark | At least one relevant source/play action or meaningful resort interaction |
| Engaged → repeat | 15–30% within 14 days during active ski windows as test target | Cohort return, excluding founder/test traffic |
| Repeat → registered/opted-in | 10–25% only if there is a valuable opt-in reason | Optional email consent; registration is not required for free utility |
| Engaged → affiliate click | 1–4% of visitors in scenario tests | Approved tracked commercial clicks, separate from camera source links |
| Affiliate click → payable conversion | 1–3% planning range, merchant/product dependent | Approved net commissions, not frontend click events |
| Engaged → paid Pro | 0 now; test 0.2–1% only after evidence | Server-confirmed payment / eligible offer cohort |


Do not multiply the entire funnel into a single fake forecast: people can monetize without registering, return without accepting analytics identifiers, or book weeks after a visit. Maintain separate paths for source utility, affiliate intent, sponsor outcomes and optional premium conversion. Report “not measurable” rather than silently filling missing stages.

## Exact event plan
| Event | Trigger | Properties | Implementation status / caveat | Purpose |
| --- | --- | --- | --- | --- |
| page_view | Page rendered | page_type,resort_id,region,source_channel | Existing analytics integration; validate payload | Acquisition denominator; bot filtering |
| resort_search | Search submitted | query_class,result_count | Proposed; do not send raw personal queries | Find unmet destination demand |
| region_filter_select | Region filter used | region,available_count | Proposed | Demand and empty-state diagnosis |
| resort_card_click | Resort selected | resort_id,position,entry_page | Validate existing implementation | Navigation conversion |
| resort_page_view | Resort detail loaded | resort_id,camera_count,verified_count | Proposed/validate | Intent denominator |
| camera_watch_open | User opens watch experience | resort_id,camera_id,embed_type | Observed in renderer | Intent; NOT proof of playback |
| camera_embed_ready | Image/iframe load event | camera_id,embed_type,elapsed_ms | Observed; iframe onLoad only | Technical load; do NOT call video view |
| camera_play_confirmed | Provider playback callback, where supported | camera_id,provider,event_source | Proposed only where technically measurable | Confirmed playback numerator |
| camera_source_click | User opens official source | camera_id,resort_id,source_host,reason | Validate tracking; proposed dimensions | Core qualified action for external mode |
| camera_fallback_shown | Timeout/error fallback appears | camera_id,error_class,elapsed_ms | Proposed/validate | Reliability diagnosis |
| camera_error | Load fails | camera_id,host,error_class | Proposed | Broken camera repair queue |
| camera_status_report | User reports broken/stale camera | camera_id,report_type | Proposed; no personal text in analytics | Human quality signal |
| favorite_add | User saves resort locally | resort_id,number_saved | Proposed; no account required | Activation |
| favorite_remove | User removes resort | resort_id | Proposed | Favorites quality |
| favorites_return | User returns and opens saved resort | resort_id,days_since_last_visit | Proposed consent-aware identifier | Retention / North Star contribution |
| share_click | User opens native share/copies URL | resort_id,camera_id,share_method | Proposed | Referral intent, not successful share proof |
| signup_start | User opens opt-in form | offer,placement | Future only | Email funnel |
| signup_confirmed | Double opt-in confirmed | offer,consent_version | Future server event; no raw email in analytics | Consented audience |
| premium_offer_view | Price-specific concept displayed | offer_id,price,currency | Experiment only, no current Pro product | Eligible concept denominator |
| premium_intent_submit | User explicitly selects paid-interest option | offer_id,price | Experiment only | Intent not sale |
| affiliate_click | User clicks approved commercial link | program,merchant,resort_id,placement,sub_id | Future after approval | Commercial outbound denominator |
| affiliate_sale_approved | Network confirms payable conversion | program,sub_id,net_commission,currency,booking_month | Import network data; no traveler PII | Earned revenue, reversal reconciliation |
| affiliate_sale_reversed | Network reverses commission | program,sub_id,net_reversal,reason_class | Import network data | Net economics |
| sponsor_impression | Visible sponsored slot enters viewport | sponsor_id,placement,resort_id | Future, count once per session rules | Auditable sponsor exposure |
| sponsor_click | User clicks labeled sponsor | sponsor_id,placement,resort_id | Future | Partner click report |
| sponsor_lead | Merchant confirms qualified referral | sponsor_id,lead_id,qualification | Future no sensitive lead detail | Outcome beyond clicks |
| consent_update | Visitor changes consent or opt-out | consent_version,choices,region_class | Proposed if applicable | Privacy controls; minimize logs |
| subscription_started | Payment confirmed server-side | plan_id,net_amount,currency | Future only after product/legal gates | Never count frontend checkout click as sale |
| subscription_canceled | Cancellation effective | plan_id,reason_class,effective_date | Future only | Churn and cancellation compliance |


## Core dashboards
A weekly product view should show human visitors, qualified-action rate, official-source versus confirmed-playback split, fallback/error rate, favorites use and 7/14/28-day return cohorts by acquisition source and destination. A partner view should show dated relevant page reach, viewable labeled slot impressions, unique clicks and any merchant-confirmed leads/bookings. A financial view should reconcile approved commissions, reversals, invoices, collected cash and direct costs.

## Data minimization and QA
Use stable internal resort/camera IDs, controlled event names and UTC event times with camera-source timezone separately. Keep raw email, names, precise location, payment details and unrestricted user text out of product analytics. Minimize persistent identifiers and apply the actual consent/opt-out requirements. A sponsor receives aggregate outcome reporting, not raw visitor identities.

Before launch, execute test journeys for external link, working image, failed iframe, fallback, mobile back navigation and opt-out. Deduplicate events caused by React rerenders or retries. Exclude founder/test traffic and obvious bots. Verify attribution joins with affiliate sub-IDs without leaking personal data. Retention comparisons should state sample size, weather/season window and collection limitations.

## Viability thresholds
By late November, target 100 measured repeat decision-makers and consistent core completion, not an arbitrary national MAU headline. By January, target at least two paid renewals and demonstrable affiliate approvals. By April, assess cash contribution, maintenance hours, paid renewal intent for next season and non-search direct return behavior. A small but recurring valuable audience can be better evidence than a viral weather spike.
