# Architectural & product decisions

Newest at the bottom. Each entry: what, why, how to reverse.

The owner approved the plan with "let's build" without answering PLAN.md §13, so every open question
was settled with the **recommended default** below. Wherever a default touches money, state or retention
it is a **tenant setting or a single constant** so it can be changed without a migration.

## Architecture (from PLAN.md §1.1)

- **D-1 Single Next.js app, route groups per audience.** One deploy, shared UI. Access is gated by layout guards *and* RLS.
- **D-2 Postgres owns the state machine.** `transition_job()` validates `(from, to, actor)` against `job_transitions`,
  runs per-edge guards, writes `job_events`, notifications, timers and outbox rows in one transaction.
  The TS map in `supabase/functions/_shared/core/state-machine.ts` is the authoring source: `npm run gen:transitions`
  regenerates the seed migration, and a Vitest test fails if they drift.
- **D-3 Transactional outbox** for side effects (courier calls, PDFs). SMS rows are queued in `notifications`.
- **D-4 Runtime-agnostic shared code** in `supabase/functions/_shared/` (no npm deps, `.ts` import extensions,
  only `fetch`/WebCrypto). Next imports it via the `@core/*` alias; Edge Functions import it relatively.
- **D-5 App-layer envelope encryption** (AES-256-GCM). `APP_MASTER_KEY` wraps a per-tenant data key in `tenant_keys`.
- **D-6 Mutations via server actions / SECURITY DEFINER RPCs**, not raw table writes from the browser.
- **D-7 Money = bigint KES cents; every payable amount is a whole shilling** (Daraja rejects decimals).
- **D-8 Tenant from Host header; membership from DB rows**, not JWT claims.
- **D-9 Auth sessions are per host** (cookie scope) — same account across shops, separate sign-in per shop domain.

## Defaults chosen for PLAN.md §13 (change any of these by telling me)

| Q | Default taken | Where it lives |
|---|---|---|
| Q-1 | Platform brand placeholder **"RepairDesk"**, domain from `PLATFORM_ROOT_DOMAIN` env (local: `localhost`, so `demo.localhost:3000`). | env |
| Q-2 | First tenant = seeded **"Demo Repairs"** until real details arrive. | seed |
| Q-3 | Consultation KES 500, deposit 50 %, 3 rounds, 48 h expiry. | `tenant_settings` |
| Q-4 | Shop's own Paybill/Till collects everything; courier bills the shop's merchant account. Delivery fee is a pass-through + optional markup. | — |
| Q-5 | **Consultation fee is credited against the repair when a quote is accepted.** | `tenant_settings.consultation_fee_credited` (default `true`) |
| Q-6 | **Prices are VAT-inclusive.** Delivery fee is treated as part of the shop's supply (inside VAT) — the conservative choice. One tax invoice at the end, a receipt per payment. Accountant to confirm deposit tax point. | `tenant_settings.prices_include_vat` (default `true`) |
| Q-7 | SMS link opens the job; if signed out, OTP screen with phone prefilled. No bearer-token auto-login. | — |
| Q-8 | 2FA **optional** for shop_admin as the brief says; tenant can make it mandatory. Platform admin: mandatory. | `tenant_settings.require_admin_mfa` (default `false`) |
| Q-9 | VAT computed once per invoice; each payable amount rounded half-up to the whole shilling; delivery fee after markup is rounded **up**. | `core/money.ts` |
| Q-10 | Customer cancels after courier booked but before pickup: courier cancelled, **pickup fee not refunded automatically**; shop_admin may record a manual refund. | — |
| Q-11 | Email via Supabase SMTP (no Resend dependency). | env |
| Q-12 | Shared/neutral SMS sender; per-tenant sender ID optional in branding. | `tenant_branding.sms_sender_id` |
| Q-13 | The 7 added states are adopted. | state machine |
| Q-14 | `collected_from_shop` and `in_transit_to_customer` kept as separate states (provider may skip the second). | state machine |
| Q-15 | Expired quote: technician may reissue; customer may decline; auto-decline after 7 days. | `tenant_settings.expired_quote_autodecline_days` |
| Q-16 | Discrepancy: customer can **acknowledge and proceed** or **reject and have the device returned** (return fee applies). Disputes are handled offline by shop_admin, who may waive the return fee. | state machine |
| Q-17 | No customer self-cancel after deposit. Shop_admin cancels and records refunds manually. | state machine |
| Q-18 | Declined supplementary quote → repair continues with the original scope. | quotes |
| Q-19 | Failed return: shop_admin or customer rebooks; re-delivery fee is charged again only if shop_admin chooses (default: not charged). After 3 days unclaimed → alert. | — |
| Q-20 | "Not as expected" on delivery → job flagged + shop_admin alert, auto-close still proceeds. | — |
| Q-21 | Tenant setting `deposit_min_quote_cents`: quotes below it need no deposit (default 0 = always deposit). | `tenant_settings` |
| Q-22 | 90-day retention deletes **photos only**; invoices, payments, events, audit kept ≥ 5 years. | `tenant_settings.retention_days` |
| Q-23 | Design assumes Supabase Pro in production (PITR, custom SMTP); local dev needs nothing. | docs |
| Q-24 | CI workflow added in Phase 1. | `.github/workflows/ci.yml` |

## Further decisions made during the build

- **D-11 No PWA plugin.** Serwist's Next plugin relies on webpack while Next 16 builds with Turbopack. A hand-written
  service worker (`public/sw.js`, ~100 lines: shell cache + offline page) plus an IndexedDB upload queue (`idb`) is smaller and has no build coupling.
- **D-12 No timezone library.** Africa/Nairobi is fixed UTC+3 with no DST; `Intl.DateTimeFormat` with `timeZone` is enough.
- **D-13 SQL renders notification templates** inside the transition transaction (simple `{var}` substitution), so
  in-app notifications appear atomically with the state change. A TS renderer with the same rules is used for the admin preview; a shared test fixture keeps them aligned.
- **D-14 Proforma before payment, numbered tax invoice on payment.** The customer sees the full itemised proforma
  in `final_payment_pending`; the invoice number is drawn from `invoice_sequences` only inside `confirm_payment()`,
  so changing the drop-off address never burns an invoice number.
- **D-15 One invoice covers the whole job** (consultation, both delivery legs, quote lines, supplementary work,
  consultation credit) and all payments (pickup fee, deposit, supplementary, balance) are applied against it.
- **D-16 MockProvider is stateless**: delivery ids encode their creation time, rider QR/OTP are HMACs of the id,
  so status is a pure function of elapsed time and it works identically in Node, Deno and tests.
- **D-17 Scheduler logic lives in `_shared/worker.ts`**, invoked by the `scheduler` Edge Function (pg_cron → pg_net, production)
  and by `POST /api/internal/tick` (local dev and a fallback for Vercel Cron). Both are protected by `INTERNAL_CRON_SECRET`.
