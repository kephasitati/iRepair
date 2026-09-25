# M-Pesa (Safaricom Daraja)

Every payment in iRepair — pickup fee, deposit, final balance, return fee, a supplementary quote — goes through
**Lipa Na M-Pesa Online** (STK Push): the customer gets a PIN prompt on their own phone, we never see or store a
PIN. Money lands directly in the shop's own Paybill or Till (DECISIONS Q-4) — the platform never touches customer
funds, it only invoices the shop separately for its own percentage fee (`platform_fee_rules`).

## Flow

1. A customer action (`initiateStkPayment`, `lib/jobs/payments.ts`) computes the amount **server-side** from the
   job's current state (`amountDue()`) — the client never sends an amount. It's rejected if the job isn't actually
   in a state where that purpose is due (e.g. you can't pay a deposit before a quote is accepted).
2. A `payments` row is inserted with a random `callback_token` (24 bytes, `randomToken()`) and a `checkoutRequestId`
   once Safaricom (or the simulator) accepts the push.
3. Safaricom calls back at `POST /api/webhooks/mpesa/[token]` — Daraja callbacks are **not signed**, so the
   per-payment token embedded in the URL is the only authentication. A guessed or reused token that doesn't match
   an `initiated`/`pending` payment is rejected.
4. `confirm_payment()` (`db/migrations/0005_functions.sql`, `SECURITY DEFINER`) is idempotent: calling it twice with
   the same `CheckoutRequestID` is a no-op once the payment already has a terminal status
   (`success`/`failed`/`timeout`/`cancelled`). It also refuses to mark a payment `success` if the amount Safaricom
   confirms doesn't exactly match what was requested — a mismatch is recorded as `failed`, never silently accepted.
5. On success, it advances the job (`pickup_fee` → `pickup_requested`, `deposit` → `in_repair`, `final_balance` →
   `dispatch_pending`, ...) inside the **same transaction** as the payment update, and keeps the job's invoice
   `paid_cents`/`balance_cents` current.
6. `worker/tasks.ts` also **polls** (`stkQuery`) any payment still `pending` after a short delay, for the case where
   Safaricom's callback never arrives (a real, if uncommon, failure mode) — so a customer isn't stuck forever behind
   a lost webhook.

## Rate limiting

`initiateStkPayment` rate-limits by phone number (3 pushes per 10 minutes, `lib/auth.ts`'s `rateLimit()`) and
refuses to send a second prompt for the same job+purpose within 60 seconds of an unresolved one — both to protect
the customer from prompt spam and to protect the shop's Daraja account from throttling.

## Per-shop credentials

Each shop enters its own Daraja app (environment, Paybill or Till, consumer key/secret, passkey) in
**Settings → Credentials**; the platform holds no shared M-Pesa credentials, since money must land in the shop's
own account, not the platform's (`app/admin/actions.ts`, encrypted with `lib/tenant-crypto.ts`, never logged).
Register the callback URL shown there with Safaricom for that shop — it's `{shop}/api/webhooks/mpesa/…`, with the
token filled in **per payment**, not per shop, so nothing to register per-transaction, only the base path.

## Local development: the simulator

`MPESA_DRIVER=simulator` (default in `.env.example`) swaps `DarajaGateway` for `SimulatorGateway`
(`lib/providers/mpesa.ts`): `stkPush` returns immediately with a fake `CheckoutRequestID`, and the payment screen
shows a "Simulate payment" button (`POST /api/dev/mpesa/simulate`) that posts a real-shaped callback body to the
same webhook route Safaricom would hit — so the whole confirm/transition/invoice path is exercised without a real
Daraja sandbox account. Every state-transition and payment-path test (`tests/db/transitions.test.ts`,
`tests/e2e/happy-path.spec.ts`) runs against the simulator, never against real Safaricom endpoints.

## Money handling rules (also in DECISIONS.md)

- Every amount is an integer in **KES cents**, end to end — no floats near money anywhere.
- VAT is computed once per invoice; each payable amount is rounded half-up to the whole shilling (Daraja only
  accepts whole-shilling amounts) — `lib/core/money.ts`.
- The consultation/diagnosis fee is credited against the repair if the quote is accepted (`tenant_settings.consultation_fee_credited`).
- The delivery fee is TumaBoda's own fare, already VAT-inclusive on their side (DECISIONS Q-6) — never re-taxed by
  the shop's own invoice.
