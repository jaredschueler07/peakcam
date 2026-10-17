# Google Ads conversion tracking

The client uses `NEXT_PUBLIC_GOOGLE_ADS_ID` (an `AW-` ID) for the base tag.
Set `NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL` to the label from a separate Google
Ads website conversion action for account registration. Set that action to
**Sign-up**, **One** conversion per ad interaction, and the primary account goal.
Use no monetary value until an actual business value has been established.
The action must use a manual event snippet, not an `/auth` page-view rule.

`AUTH_SIGNUP_COMPLETED` sends the registration conversion. The existing auth
flow emits this after email confirmation, or after sign-up immediately creates
an authenticated session when confirmation is disabled. Form submissions,
regular page views and powder-alert subscriptions do not emit this conversion.
The existing callback marker is consumed once and removed from the URL.
Browser blocking or a failed confirmation callback can still prevent reporting;
compare advertising results with confirmed accounts and product analytics.

`NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL` remains a separate optional powder-alert
conversion. Leaving the signup label unset does **not** fall back to that action.
No event properties, email addresses or email domains are forwarded to Google.
The shared initializer preserves an existing `gtag`/data layer, queues config
before events, and configures the account once per page, so a conversion that
precedes the dynamically loaded component is retained.

All three variables are public, build-time values. Configure the desired Vercel
environment and rebuild; changing project variables alone does not update an
existing deployment. Preview builds should use test values or leave them unset
so QA does not create real advertising conversions.

Before enabling ads:

1. Verify the conversion action's ID/label and primary goal in Google Ads.
2. Verify the deployed base tag with Tag Assistant and the confirmation flow.
3. Confirm one registration event on completion and none on form submit,
   ordinary sign-in, alert signup or reloading the cleaned confirmation URL.
4. Check that the campaign optimizes/reports the account action separately from
   page views. A new action may take time to update its status in Google Ads.

Rollback: remove the signup label and rebuild to stop account conversions; remove
the Ads ID and rebuild to disable the entire Google tag. The code change can also
be reverted independently of the Meta pixel and auth flow.

References: [Google tag setup](https://developers.google.com/tag-platform/gtagjs),
[Google Ads conversions](https://developers.google.com/tag-platform/devguides/conversions).
