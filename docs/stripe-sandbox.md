# Stripe Sandbox Switch

This app can run billing against Stripe sandbox data without changing the frontend.

## Runtime switch

The auth gateway now supports a billing mode switch:

```bash
cd server
export STRIPE_BILLING_MODE=sandbox
```

When `STRIPE_BILLING_MODE=sandbox`, the gateway reads:

- `STRIPE_SANDBOX_SECRET_KEY`
- `STRIPE_SANDBOX_WEBHOOK_SECRET`
- `STRIPE_SANDBOX_PRICE_COZEA_*`

If those are unset, it falls back to the legacy unsuffixed `STRIPE_*` variables.

## Bootstrap sandbox catalog

Create or refresh the Stripe sandbox products/prices first:

```bash
cd server
STRIPE_BILLING_MODE=sandbox npm run stripe:bootstrap
```

That prints the `STRIPE_SANDBOX_PRICE_COZEA_*` values to store in the gateway env.

## Import live subscriptions into sandbox

The import script is dry-run by default:

```bash
cd server
export STRIPE_LIVE_SECRET_KEY=sk_live_...
export STRIPE_SANDBOX_SECRET_KEY=sk_test_...
npm run stripe:import:sandbox
```

Execute for real:

```bash
cd server
npm run stripe:import:sandbox -- --execute
```

Useful flags:

```bash
--limit=25
--emails=user@example.com,owner@example.com
--statuses=active,trialing
--output=.cache/stripe-import-report.json
--test-clock=clock_...
--days-until-due=30
```

## Import behavior

The script:

- matches or creates sandbox products/prices
- matches or creates sandbox customers
- recreates `active` and `trialing` subscriptions
- preserves future `trial_end` for trialing subscriptions
- creates non-trialing sandbox subscriptions with `collection_method=send_invoice`

It does **not** copy:

- payment methods
- invoice/payment history
- existing Stripe IDs into your app database

It writes a JSON report so you can inspect the mapping before switching the app.

## Webhooks with Stripe CLI

Forward sandbox webhooks to the local gateway:

```bash
cd server
stripe listen \
  --forward-to http://localhost:3001/stripe/webhook \
  --api-key "$STRIPE_SANDBOX_SECRET_KEY"
```

Use the emitted webhook signing secret as `STRIPE_SANDBOX_WEBHOOK_SECRET`.

## Switch the app to sandbox

1. Set the gateway env:
   - `STRIPE_BILLING_MODE=sandbox`
   - `STRIPE_SANDBOX_SECRET_KEY`
   - `STRIPE_SANDBOX_WEBHOOK_SECRET`
   - `STRIPE_SANDBOX_PRICE_COZEA_*`
2. Restart or redeploy the gateway.
3. Re-import sandbox subscriptions if needed.
4. Reload the desktop app and verify the Billing page.
