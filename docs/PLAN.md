# Device Repair Pickup & Return Platform — Build Plan

Status: **DRAFT, awaiting owner review.** No application code will be written until this is approved.
Date: 2026-09-24

---

## 0. TL;DR

- One Next.js app (App Router, TypeScript) on Vercel, one Supabase project (Postgres, Auth, Storage, Realtime, Edge Functions). Multi-tenant from the first migration: every business row carries `tenant_id` and every table has RLS.
- The job lifecycle is **one state machine with one source of truth**. The Postgres function `transition_job()` checks every move against a `job_transitions` table and writes `job_events` in the same transaction. A pure-TypeScript transitions map mirrors it for the UI and tests, and a test fails if the two disagree.
- External side effects (create a TumaBoda delivery, send an SMS, generate a PDF) are **never run inside the transition**. The transition writes an `outbox` row in the same transaction, and a worker runs it idempotently with retries. This keeps "payment confirmed + state changed" atomic and makes webhooks safe to replay.
- Integrations (Daraja, Africa's Talking, TumaBoda, Mock courier) are adapters written with only `fetch` and WebCrypto, so the **same code runs in Next.js (Node) and in Edge Functions (Deno)**.
- Phase 1 runs end to end on the `MockProvider` courier and the Daraja and Africa's Talking **sandboxes**. The real TumaBoda adapter lands in Phase 2 once I have their API docs (§12 lists what I need).
- **I found 24 open questions and a few places where the brief contradicts itself (§13).** Several affect money flow and state transitions, so I need your answers before building those parts.

---

## 1. Architecture

```
            ┌───────────────────────── Vercel ─────────────────────────┐
 Customer ─▶│ Next.js (App Router)                                      │
 Tech/Admin │  middleware: Host ─▶ tenant lookup (cached) ─▶ x-tenant-id│
 Platform   │  server actions (mutations) · route handlers (PDF, links, │
            │  manifest.webmanifest per tenant, TumaBoda/AT fallbacks)  │
            │  Serwist service worker (PWA, offline shell, upload queue)│
            └───────────────┬───────────────────────────────────────────┘
                            │ supabase-js (user JWT → RLS enforced)
            ┌───────────────▼──────────── Supabase ─────────────────────┐
            │ Postgres: tables + RLS + transition_job() + outbox        │
            │ pg_cron (every minute) ─▶ pg_net ─▶ Edge Fn `scheduler`   │
            │ Edge Functions: mpesa-callback, delivery-webhook,         │
            │   sms-dlr, auth-sms-hook, outbox-worker, scheduler        │
            │ Storage: private buckets (job-photos, invoices, branding*)│
            │ Realtime: jobs, job_events, notifications, negotiations   │
            └───────┬───────────────┬────────────────┬──────────────────┘
                    ▼               ▼                ▼
              Safaricom Daraja  Africa's Talking   TumaBoda API / Mock
```
\* `branding` is the only bucket with public read (logos must load on the landing page before login). It holds logos and icons only, never customer data. See D-10.

### 1.1 Key architectural decisions (these go into DECISIONS.md once approved)

| # | Decision | Why |
|---|---|---|
| D-1 | **Single Next.js app** with route groups per audience (`(shop)` customer, `bench` technician, `admin` shop admin, `platform` platform admin), not separate apps | One deploy, shared components, simpler tenant resolution. Access is gated by role in layouts **and** by RLS. |
| D-2 | **Postgres is the source of truth for state transitions.** `job_transitions(from_status, to_status, actor_kinds[])` is seeded from the TS map by a generated migration. A Vitest test and a pgTAP test assert both are identical. | "Payment confirmation and state transition in one DB transaction" is only guaranteed if the transition lives in the DB. Illegal transitions raise an exception in SQL, so even a buggy client can't skip a state. |
| D-3 | **Transactional outbox** for all side effects | Makes callbacks and webhooks idempotent and retryable. A failed TumaBoda call doesn't roll back a confirmed payment; it retries with backoff and alerts after N failures. |
| D-4 | **Shared runtime-agnostic core** in `supabase/functions/_shared/` (state machine, money/VAT, phone, IMEI, template rendering, crypto, all provider adapters). Next imports it through the `@core/*` path alias. | The Supabase CLI bundles `_shared` into Edge Functions natively, so there's one copy and no build step. The rule: no Node-only or Deno-only APIs there (only `fetch`, WebCrypto, `URL`). |
| D-5 | **App-layer envelope encryption** (AES-256-GCM via WebCrypto). A platform master key (env secret) wraps a random 256-bit data key per tenant, stored in `tenant_keys`. Used for passcodes, Daraja creds, TumaBoda keys and AT keys. | Per-tenant keys as the brief requires, works in both runtimes, and doesn't depend on DB extensions that may change. Rotating the master key only re-wraps the data keys. |
| D-6 | **Mutations go through server actions or RPCs, never direct table writes from the browser** (except `job_photos` upload metadata and `negotiations` messages, which have narrow RLS insert policies) | Business rules live in one place, and audit logging is guaranteed. |
| D-7 | **Money = `bigint` KES cents.** All M-Pesa amounts must be **whole shillings**, so every payable amount is rounded to the whole shilling at the last step (see Q-9). | Daraja rejects decimals. |
| D-8 | **Tenant from Host header, membership from DB.** The JWT carries no tenant claim. RLS checks `tenant_memberships` directly. | One user can be staff at two shops (or a customer of two). Claims go stale, DB rows don't. |
| D-9 | **Sessions are per host** (Supabase auth cookies are host-bound). The same customer account works on every shop's domain, but they sign in once per domain. | This is the "sessions scoped to tenant" requirement, and it comes for free. |
| D-10 | **Libraries (all boring and widely used):** shadcn/ui + Tailwind, react-hook-form + zod, next-intl (`messages/en.json`), Serwist (PWA), idb (offline upload queue), @zxing/browser (QR, because iOS Safari lacks `BarcodeDetector`), @vis.gl/react-google-maps (Places + pin), libphonenumber-js, @react-pdf/renderer (invoices, runs in Node), date-fns-tz, Vitest, Playwright, pgTAP via `supabase test db`. | All MIT/Apache, mature, no paid services. |

### 1.2 Repository layout

```
/app                      Next.js routes
  /(shop)                 customer-facing, tenant-branded
  /bench                  technician (board, job, scanner)
  /admin                  shop_admin (settings, staff, parts, reports, refunds)
  /platform               platform_admin (tenants, fees, monitor, impersonation)
  /api                    route handlers: invoices/[id].pdf, l/[code] short links, manifest
/components               UI (shadcn-based)
/lib                      Next-only helpers (supabase clients, tenant context, auth guards)
/messages/en.json         every UI string (i18n)
/supabase
  /migrations             SQL: schema, RLS, functions, seed of transitions & templates
  /functions/_shared      runtime-agnostic core + adapters (D-4)
  /functions/<name>       mpesa-callback, delivery-webhook, sms-dlr, auth-sms-hook, outbox-worker, scheduler
  /tests                  pgTAP (RLS isolation, transitions, idempotency)
  /seed.sql + scripts/seed.ts
/tests/unit, /tests/e2e   Vitest, Playwright
/docs                     PLAN, DECISIONS, STATE_MACHINE, MPESA, TUMABODA, COMPLIANCE, WHITELABEL, HANDOVER-*
Dockerfile, docker-compose.yml, .env.example, .github/workflows/ci.yml
```

---

## 2. Multi-tenancy & white-label

- **Resolution:** middleware reads `Host`, then looks up `tenant_domains(hostname → tenant_id)` (cached in memory about 60 s and busted by `revalidateTag` on settings change). Unknown host goes to the platform marketing page (or 404). Suspended tenant gets a neutral "temporarily unavailable" page with the shop's phone.
- **Domains:** `shop-slug.<platform-domain>` through a Vercel wildcard domain. **This needs the platform domain's nameservers on Vercel** (Q-1). Custom domains (`repairs.shop.co.ke`) are added through the Vercel Domains API from the platform console. The shop owner then adds a CNAME, and the console shows verification status.
- **Branding per request:** name, logo, primary/accent colours (applied as CSS variables and validated for contrast), favicon/app icons, and a dynamic `manifest.webmanifest` per host. PDFs, SMS templates and email templates all read `tenant_branding`. **The platform brand is never rendered to customers** (enforced by a lint rule plus an e2e assertion that searches the page text).
- **SMS sender ID:** Africa's Talking alphanumeric sender IDs must be registered per brand with the telcos, which costs time and money. Default is a shared/neutral sender with the shop name in the message body. Tenants with their own sender ID set it in settings (Q-12).
- **Platform admin** is a row in `platform_admins` (not a tenant role). The RLS helper `is_platform_admin()` grants cross-tenant read. **Impersonation** = "support mode": the platform admin picks a tenant and acts through server actions that write `audit_log` entries tagged `impersonated_by`. No session forging, and a banner is always visible. It's time-boxed (60 min) and needs a reason.
- **Tenant billing (future):** `platform_fee_rules(tenant_id, kind: flat|percent, value, effective_from)` and `platform_fee_ledger(tenant_id, job_id, amount_cents, basis, invoiced_at)` are created now and written on job close from Phase 1. Invoicing them is Phase 3.

---

## 3. Roles & access

| Role | Where it lives | Can see |
|---|---|---|
| customer | any `auth.users` row with a `customer_profiles` row (platform-level) | Own jobs (across all shops, but the UI filters to the current host's shop), own devices and addresses |
| technician | `tenant_memberships(role='technician')` | All jobs of their tenant **except** job secrets (IMEI/serial, passcode) unless they're the assigned tech |
| shop_admin | `tenant_memberships(role='shop_admin')` | Everything in their tenant, including secrets (passcode reads are audited) |
| platform_admin | `platform_admins` | Cross-tenant read. Writes only through audited support mode |
| rider | not a user | Only through the TumaBoda API and QR/OTP |

RLS helper functions (`SECURITY DEFINER`, `STABLE`): `is_platform_admin()`, `has_tenant_role(tenant_id, roles text[])`, `is_job_customer(job_id)`, `is_assigned_tech(job_id)`. Every table gets policies built from these, and pgTAP tests prove tenant A can't read or write any row of tenant B, for every table.

IMEI/serial and the passcode ciphertext live in a separate table, **`job_secrets`**, with stricter RLS (customer, assigned tech, shop_admin), so column-level exposure can't leak through `select *`.

---

## 4. Data model

Every table has `id uuid pk`, `created_at`, `updated_at` where mutable. Every business table has `tenant_id` (FK, indexed, part of composite indexes). Money columns are `*_cents bigint`. Timestamps are `timestamptz`, displayed in Africa/Nairobi.

**Tenancy & config**
- `tenants` (slug, name, status: active|suspended, created_by)
- `tenant_domains` (hostname unique, kind: subdomain|custom, verified_at)
- `tenant_branding` (logo_path, icon_path, primary_hex, accent_hex, sms_sender_id, email_from_name)
- `tenant_settings` (contact_phone, address_id, kra_pin, vat_registered, vat_rate_bp default 1600, consultation_fee_cents, deposit_rule {kind: percent|fixed, value}, max_negotiation_rounds default 3, quote_expiry_hours default 48, delivery_markup_bp default 0, retention_days default 90, quiet_hours {start '21:00', end '07:00'}, opening_hours jsonb, service_zones text[], delivery_provider: mock|tumaboda, publish_price_list bool, auto_close_hours default 48)
- `tenant_secrets` (encrypted blobs: daraja {consumer_key, consumer_secret, shortcode, passkey, type: paybill|till, till_number?}, tumaboda {api_key, webhook_secret, base_url}, africastalking {username, api_key})
- `tenant_keys` (wrapped_data_key, key_version)
- `platform_admins`, `platform_fee_rules`, `platform_fee_ledger`

**People**
- `customer_profiles` (user_id pk, full_name, phone_e164 unique, email) — platform-level
- `tenant_memberships` (tenant_id, user_id, role: technician|shop_admin, active)
- `addresses` (owner user_id, label, formatted, place_id, lat, lng, landmark, building_floor, zone) — platform-level, owned by the customer. Tenants only see **snapshots** copied onto jobs and deliveries.
- `devices` (owner user_id, type, brand, model, colour, storage, imei_or_serial) — owned by the customer and snapshotted onto the job

**Jobs**
- `jobs` (tenant_id, ref e.g. `DR-24-00123` sequenced per tenant, customer_user_id, assigned_tech_id, status job_status, outcome: null|repaired|declined|cancelled, device_snapshot jsonb, fault_description, declared_condition jsonb, accessories text[], passcode_locked bool, passcode_shared bool, pickup_address_snapshot, pickup_window tstzrange, dropoff_choice: pickup_address|other_address|collect_at_shop, dropoff_address_snapshot, dropoff_window, intake_discrepancy bool, cancel_reason, closed_at)
- `job_secrets` (job_id pk, tenant_id, imei_or_serial, passcode_ciphertext, passcode_key_version, purged_at)
- `job_events` **append-only** (job_id, tenant_id, from_status, to_status, event_kind, actor_kind: customer|technician|shop_admin|platform_admin|system|provider, actor_user_id, payload jsonb, created_at). UPDATE/DELETE are revoked from every role, and a trigger blocks them.
- `job_transitions` (from_status, to_status, allowed_actor_kinds) — seeded, read-only
- `job_photos` (job_id, tenant_id, stage: customer_declared|intake|progress|completion|discrepancy|handover, kind: front|back|screen_on|other, storage_path, taken_at, uploaded_by, client_upload_id unique — for idempotent offline retries)
- `intake_checklists` (job_id, imei_read, imei_matches bool, accessories_received text[], condition_checks jsonb, powers_on bool, summary, completed_by, completed_at)
- `discrepancies` (job_id, field, declared_value, observed_value, note, photo_ids[], acknowledged_by_customer_at)
- `job_progress_updates` (job_id, template_key, body, photo_ids[], created_by)
- `completion_checklists` (job_id, tests jsonb, notes, completed_by)
- `ratings` (job_id unique, score 1–5, comment)

**Quotes**
- `quotes` (job_id, kind: main|supplementary, status: draft|sent|negotiating|accepted|declined|expired, current_version_id, rounds_used, accepted_total_cents, collect_upfront bool — supplementary only)
- `quote_versions` (quote_id, version_no, author: tech|customer_counter, subtotal_cents, vat_cents, total_cents, deposit_cents, turnaround_days, expires_at, message, sent_at) — **immutable once `sent_at` is set** (trigger-enforced)
- `quote_line_items` (quote_version_id, kind: part|labour|other, part_id nullable, description, qty, unit_price_cents, line_total_cents)
- `negotiations` (quote_id, author_user_id, author_side: customer|shop, kind: message|counter|accept|decline|revision, proposed_total_cents, body, quote_version_id) — the chat thread
- `parts_catalogue` (tenant_id, sku, name, device_family, default_price_cents, published bool, active)

**Logistics**
- `deliveries` (job_id, leg: pickup|return, provider, quote_ref, provider_delivery_id, tracking_url, fee_cost_cents, fee_charged_cents, status, rider_snapshot jsonb {name, phone, plate}, scheduled_for, created_at, raw_last_status jsonb)
- `handover_events` (job_id, delivery_id, point: customer_to_rider|rider_to_shop|shop_to_rider|rider_to_customer|counter_collection, method: qr|otp|manual_override, actor_user_id, rider_snapshot, geo point nullable, photo_ids[], verified bool, provider_response jsonb)

**Money**
- `payments` (tenant_id, job_id, purpose: pickup_fee|deposit|final_balance|return_fee|supplementary, amount_cents, phone_e164, idempotency_key unique, merchant_request_id, checkout_request_id unique, callback_token, status: initiated|pending|success|failed|timeout|cancelled, result_code, result_desc, mpesa_receipt unique nullable, confirmed_at, reconcile_attempts)
- `refunds` (payment_id, amount_cents, reason, method: mpesa_manual|cash|bank, reference, recorded_by)
- `invoices` (tenant_id, job_id, number e.g. `INV-2026-000123`, lines jsonb snapshot, subtotal_cents, vat_cents, total_cents, paid_cents, balance_cents, pdf_path, etims_status: not_applicable|pending|submitted|failed, etims_payload jsonb) — **eTIMS hook columns exist from Phase 1**
- `invoice_sequences` (tenant_id, year, next_value) — incremented with `UPDATE … RETURNING` inside the invoice transaction (gap-free per tenant per year)
- `receipts` — optional; a receipt screen can be rendered from `payments` (Q-10)

**Messaging & ops**
- `notification_templates` (tenant_id nullable = platform default, event_key, audience: customer|staff, channel: sms|email|in_app|whatsapp, body, critical bool)
- `notifications` (tenant_id, user_id, job_id, channel, template_key, rendered_body, status: queued|held_quiet_hours|sent|delivered|failed, provider_message_id, send_after)
- `outbox` (tenant_id, kind, payload, dedupe_key unique, status, attempts, next_attempt_at, last_error)
- `webhook_events` (source: mpesa|tumaboda|africastalking, raw_body, headers, signature_valid, dedupe_key, received_at, processed_at, error) — written **before** processing
- `timers` (job_id, kind: quote_expiry|deposit_reminder|final_payment_reminder|dropoff_reminder|unclaimed_alert|auto_close|payment_reconcile, due_at, fired_at, cancelled_at)
- `rate_limits` (bucket e.g. `otp:+2547…`, window_start, count)
- `audit_log` (tenant_id, actor_user_id, impersonated_by, action, entity, entity_id, diff jsonb, ip, user_agent, created_at) — append-only
- `short_links` (code, tenant_id, job_id, expires_at)

---

## 5. Job state machine

### 5.1 States
The brief's 20 states, plus **7 I'm proposing** (marked ★) to cover paths the brief describes but doesn't name. All need your approval (Q-13).

```
draft → pickup_fee_pending → pickup_requested → rider_en_route_to_customer → picked_up
→ in_transit_to_shop → received_at_shop → [★intake_ack_pending] → diagnosing → quote_sent
⇄ quote_negotiating → deposit_pending → in_repair → repair_complete → final_payment_pending
→ dispatch_pending → return_requested → rider_en_route_to_shop → collected_from_shop
→ in_transit_to_customer → delivered → closed

Declined:   quote_sent/negotiating/★quote_expired → quote_declined → ★return_fee_pending
            → return_requested → … → delivered → declined_returned
Collect:    dispatch_pending → ★ready_for_collection → closed / declined_returned
Failures:   pickup_requested/rider_en_route_to_customer → ★pickup_failed → pickup_requested | cancelled
            return legs → ★return_failed (device back at shop) → return_requested | ★ready_for_collection
Cancel:     draft/pickup_fee_pending → cancelled (free)
            after delivery created → ★return_fee_pending (if device has left the customer) or cancelled (if not)
            shop_admin: any non-terminal → cancelled (with reason; return flow if device is at shop)
Terminal:   closed, cancelled, declined_returned
```

Why each new state:
- **intake_ack_pending**: the brief says diagnosis must not start until the customer acknowledges a discrepancy. A state makes that enforceable. It's skipped automatically when there's no discrepancy.
- **quote_expired**: the brief sets expiry but not what happens after. Proposal: the customer can ask for a re-quote (tech issues a new version → `quote_sent`) or decline. It auto-declines after 7 days with no action (Q-15).
- **return_fee_pending**: the declined and cancelled paths both need a payment step before the return delivery. The brief says "customer pays it" but gives the step no state.
- **ready_for_collection**: "collect at shop" skips delivery, so the job needs a place to wait and a counter-handover confirmation.
- **pickup_failed / return_failed**: the rider can't reach the customer, the customer isn't home, or the rider cancels. TumaBoda will report these, so the job must not get stuck.

Terminal state after `delivered` depends on `jobs.outcome` (repaired → `closed`, declined → `declined_returned`, cancelled → `cancelled`), so the return legs are shared code, not three copies.

### 5.2 Guarded transitions (how each move is triggered)

| From → To | Actor | Guard / trigger |
|---|---|---|
| draft → pickup_fee_pending | customer | wizard complete: ≥2 photos (front, back, + screen_on if powers on), valid IMEI (Luhn) or serial, address inside service zones, window within opening hours |
| pickup_fee_pending → pickup_requested | system | `confirm_payment()` for purpose pickup_fee, in the same tx. Outbox: `delivery.create(pickup)` |
| pickup_requested → rider_en_route_to_customer | provider | webhook/poll: rider assigned. Outbox: SMS with rider details |
| rider_en_route_to_customer → picked_up | customer (QR) / provider (OTP) | valid `verifyRiderQr` or OTP proof. Writes a `handover_events` row with geo + declared photo ids |
| picked_up → in_transit_to_shop | provider | webhook (or immediate, if the provider doesn't distinguish) |
| in_transit_to_shop → received_at_shop | technician | QR or OTP verified at the bench |
| received_at_shop → diagnosing / intake_ack_pending | technician | intake checklist submitted. Any discrepancy → `intake_ack_pending` |
| intake_ack_pending → diagnosing | customer | acknowledges the discrepancies (Q-16: what if they dispute?) |
| diagnosing → quote_sent | technician | quote v1 sent. Timer: quote_expiry |
| quote_sent ⇄ quote_negotiating | customer counter / tech revision | round cap enforced in SQL. At the cap, only accept/decline |
| quote_sent/negotiating → deposit_pending | customer or tech | accept (tech accepting a customer counter creates an accepted version with that total). If deposit = 0 → straight to in_repair |
| deposit_pending → in_repair | system | payment confirmed (purpose deposit) |
| in_repair → repair_complete | technician | completion checklist + ≥1 after photo. Blocked while a supplementary quote is open |
| repair_complete → final_payment_pending | customer | drop-off choice + window saved. The system gets a delivery quote (unless collecting), builds the invoice draft |
| final_payment_pending → dispatch_pending | system | payment confirmed (final_balance), same tx. If balance = 0 → immediate |
| dispatch_pending → return_requested | system | automatically in the same tx. Outbox: `delivery.create(return)` |
| dispatch_pending → ready_for_collection | system | when drop-off = collect_at_shop |
| return_requested → rider_en_route_to_shop | provider | rider assigned |
| rider_en_route_to_shop → collected_from_shop | technician | rider QR scanned at the bench |
| collected_from_shop → in_transit_to_customer | provider | webhook (may merge with the one above, Q-14) |
| in_transit_to_customer → delivered | provider OTP / customer QR | proof of delivery |
| delivered → closed/declined_returned/cancelled | customer / system | customer confirms + rates, or `auto_close` timer at 48 h |
| ready_for_collection → closed/declined_returned | technician | counter handover (customer shows job QR or an OTP sent by SMS) |
| quote_* → quote_declined | customer | decline |
| quote_declined → return_fee_pending → return_requested | system | return quote, then payment confirmed (return_fee). Or → ready_for_collection if the customer chooses to collect |

**Every** transition, in `transition_job(job_id, to_status, actor_kind, actor_user_id, payload)`, does this:
1. Lock the job row (`SELECT … FOR UPDATE`).
2. Check `(from,to,actor)` against `job_transitions`, then run the guard function for that edge. Raise on failure.
3. Update `jobs.status` and insert into `job_events`.
4. Insert outbox rows (notifications, provider calls) and schedule or cancel timers.
5. On terminal: set the `job_secrets.passcode_ciphertext = NULL, purged_at = now()` purge and write the platform fee ledger row.

### 5.3 Supplementary quotes
A sub-entity inside `in_repair` (`quotes.kind = 'supplementary'`), with the same negotiate/accept/decline flow but no job-state change. Accepted amounts roll into the final invoice. `collect_upfront` optionally triggers a `supplementary` STK payment. Data model is in Phase 1, UI is in Phase 2 (per the brief).

---

## 6. Payments (M-Pesa Daraja)

- **initiate:** a server action creates a `payments` row (`idempotency_key = job_id:purpose:attempt_no`) and calls STK Push with `CallBackURL = …/functions/v1/mpesa-callback/<callback_token>` (a random per-payment token, because Daraja callbacks are **unsigned**). It stores MerchantRequestID/CheckoutRequestID and sets status `pending`. The phone is rate-limited to 3 pushes / 10 min.
- **callback (Edge Function):**
  1. Insert raw into `webhook_events`.
  2. Validate the shape with zod.
  3. Look up by `checkout_request_id` and compare the `callback_token`.
  4. If already terminal, return 200 (idempotent).
  5. `ResultCode 0`: check the amount equals the requested amount, then call the RPC `confirm_payment(checkout_request_id, receipt, amount, raw)`. That **one transaction** marks it success, stores the receipt, runs `transition_job()`, and enqueues the receipt SMS.
  6. `1032` → cancelled, `1037` → timeout, `1` → failed (insufficient funds), others → failed. The customer can retry, which creates a new attempt row.
  7. Always return 200 to Safaricom.
- **Reconcile:** a `payment_reconcile` timer fires 2 min after initiation. If still pending, it calls the STK Query API and feeds the result into the **same** `confirm_payment()` / fail path. So "callback-driven" stays true and the query is only a safety net. The same function makes duplicates harmless.
- **Paybill vs Till:** `CustomerPayBillOnline` vs `CustomerBuyGoodsOnline` (Till uses the store number as BusinessShortCode and the till as PartyB). Both are supported through tenant settings.
- **Sandbox first** (shortcode 174379). `docs/MPESA.md` will cover the go-live checklist: Daraja app per tenant, Go-Live approval, passkey, production URLs, callback URL reachability, IP allowlist option.
- **Refunds:** manual records only (B2C out of scope). The job page shows net paid.

---

## 7. Delivery providers

- `DeliveryProvider` interface exactly as in the brief, plus a `capabilities` field (`{ qr: boolean; otp: boolean; scheduling: boolean; webhooks: boolean }`) so the UI can offer the OTP fallback when QR isn't supported.
- **MockProvider:** deterministic. Delivery status comes from elapsed time since creation (assigned +1 min, arrived +3, picked up on scan, …). A dev-only "advance" button and `scheduler` tick push it forward. The fake rider QR is a signed payload `MOCK:<deliveryId>:<hmac>` shown on a `/dev/rider/<id>` page you open on a second phone. Fee is distance-based from lat/lng (haversine × rate) so the numbers look realistic.
- **TumaBodaProvider:** Phase 2, against real docs. Until then it's a typed skeleton with `// TODO(TUMABODA):` markers.
- **Webhooks:** `delivery-webhook/<tenant_slug>` → raw log → `parseWebhook` (signature check, timestamp tolerance ±5 min, `dedupe_key` unique → replays rejected) → map to job transition.
- **Fee to customer** = `ceil_to_shilling(cost × (1 + markup_bp/10000))`. Cost and charged fee are both stored for the "delivery spend" report.

---

## 8. Notifications

- `notify(event_key, job)` renders every matching template (tenant override → platform default) into `notifications` rows through the outbox. Channels are adapters behind one `NotificationChannel` interface: `in_app` (Realtime on the `notifications` table), `sms` (Africa's Talking), `email` (Supabase SMTP or Resend, Q-11), `whatsapp` (Phase 3 stub).
- **Quiet hours:** non-critical SMS inside the tenant window get `send_after = next 07:00 EAT`. Critical ones (OTP, payment receipts, rider arriving, handover) ignore quiet hours.
- **Placeholders:** `{customer_name} {job_ref} {amount} {tracking_url} {shop_name} {job_link} {rider_name} {rider_phone} {plate} {receipt}`. Unknown placeholders fail template save validation. Passcodes and IMEIs can **never** be template variables (enforced by a whitelist).
- **Deep links:** `https://<shop-host>/l/<8-char code>` → job page. See Q-7 on auto-login.
- **SMS delivery reports** go to the `sms-dlr` function, which updates `notifications.status`.

---

## 9. Auth

- **Customer:** phone + OTP through Supabase Auth phone provider with the **Send SMS Hook** → `auth-sms-hook` Edge Function → Africa's Talking. Input accepts `07XX…`, `01XX…`, `+254…`, `254…` and normalizes to E.164 with libphonenumber-js. Rate limit: 3 OTPs / 15 min / phone and 10 / hour / IP. Email+password is secondary. Google sign-in is behind a feature flag (off by default).
- **Staff:** email + password, zxcvbn score ≥ 3, min 12 chars. TOTP 2FA through Supabase MFA, **optional per the brief** (I recommend making it mandatory for shop_admin, Q-8). Staff are invited by shop_admin (invite email → set password).
- **Platform admin:** same as staff with **mandatory** TOTP.

---

## 10. PWA & offline

- Serwist service worker: app shell precache, stale-while-revalidate for branding and static assets, network-first for data.
- **Photo upload queue:** photos are compressed client-side (max 1600 px, JPEG 0.8, about 250 KB each on 3G), written to IndexedDB with a `client_upload_id`, then uploaded with retries on `online`/visibility events (Background Sync isn't available on iOS, so it doesn't depend on it). The server dedupes on `client_upload_id`. The wizard can't submit until required photos are uploaded, and it shows the queue state.
- QR scanning through `getUserMedia` + @zxing/browser, with a manual code entry fallback always shown.
- 360 px layout baseline, 44 px minimum tap targets, no animation libraries.

---

## 11. Security & compliance (summary; the full version goes in COMPLIANCE.md)

- Private Storage buckets (except `branding`) with 5-minute signed URLs. Storage RLS mirrors job access.
- **Passcode:** encrypted (D-5), revealed only through the `reveal_passcode(job_id)` server action (assigned tech or shop_admin, job non-terminal). Every reveal is audited, never logged, and purged on terminal state. Logs pass through a redactor for `passcode|imei|serial|pin`.
- Audit log on every staff mutation (server-action wrapper + DB triggers on sensitive tables).
- **Retention:** photos deleted after `retention_days` by a scheduled job. **Invoices, payments and job_events are not deleted at 90 days.** Kenyan tax law requires records to be kept (5 years under the Tax Procedures Act), so the brief's 90-day rule applies to photos only (Q-18).
- **Kenya DPA:** tenant = controller, platform = processor. A per-tenant privacy page is generated from settings. COMPLIANCE.md will include a DPA clause template and a note that controllers and processors may need to **register with the ODPC**. Tenants should confirm with counsel.
- **Backups:** Supabase daily backups (PITR on Pro, which is a paid Supabase add-on, Q-19) plus a documented `pg_dump` restore drill.

---

## 12. TumaBoda: what I need from you

1. API docs link and the sandbox base URL, sandbox API key, and webhook secret.
2. **Quote** endpoint: request fields (lat/lng or address?), response (fee, ETA, quote id, validity period).
3. **Create delivery**: fields for item description, declared value/insurance, sender and recipient phones, instructions, scheduled time, and **our job reference**. Does it accept an idempotency key?
4. **Cancel**: rules, and the fee charged by stage.
5. **Status** endpoint and the full list of status values (so I can map them to our states), including failed and returned states.
6. **Webhooks:** event types, payload schema, **signature algorithm and header names**, timestamp/replay protection, retry policy.
7. **Rider QR:** what the QR encodes, and the endpoint to verify "this QR belongs to the rider assigned to delivery X" (returning name, phone, plate).
8. **OTP proof of pickup/delivery**: who receives the OTP (customer SMS?), and the verify endpoint.
9. Live **tracking URL**: public share link or embeddable map? Does it expire?
10. Auth scheme: API key header, OAuth, or per-merchant? Rate limits? Sandbox test riders?
11. **Billing:** is each shop's TumaBoda merchant account charged per delivery (prepaid wallet or invoice)? This determines whether the shop's collected delivery fee is a pass-through (§13 Q-4).

---

## 13. Questions & conflicts (please answer in one pass)

**Money flow**
- **Q-1** Platform brand name and domain, and can its DNS be on Vercel (needed for wildcard subdomains)?
- **Q-2** First tenant details: name, logo, colours, Paybill or Till (+ store number if Till), KRA PIN, VAT-registered?, address, opening hours, service zones.
- **Q-3** First tenant's consultation fee, deposit rule, negotiation rounds, quote expiry. (Defaults if not given: KES 500, 50%, 3, 48 h.)
- **Q-4** Delivery fees are collected by the shop's Paybill, but TumaBoda bills the shop's merchant account separately. Confirm that's the intended flow (the shop fronts the courier cost and recovers it from the customer).
- **Q-5** **Is the consultation fee credited against the repair if the quote is accepted?** (It's common practice, and changes the final invoice maths.)
- **Q-6** **VAT:** are catalogue prices and quote line items entered **VAT-inclusive** (typical for Kenyan retail) or exclusive? Is the delivery fee a VAT-able supply by the shop, or a disbursement shown outside VAT? Your accountant should confirm the tax point on deposits (VAT is generally due on the earliest of supply, invoice or payment). I'll issue a receipt per payment and one tax invoice at the end unless told otherwise.
- **Q-7** **SMS magic-link auto-login:** Supabase can't mint magic links for phone-only users, and an auto-login link in an SMS is a bearer token anyone who sees the SMS can use. **Recommendation:** the link opens the exact job, and if signed out the OTP screen appears with the phone prefilled (one tap + code). OK?
- **Q-8** Make TOTP 2FA **mandatory** for shop_admin (recommended, since they see passcodes and issue refunds)?
- **Q-9** Rounding: M-Pesa takes whole shillings. OK to round VAT once per invoice (not per line) and round each payable amount to the nearest shilling, with the rounding shown as a line?
- **Q-10** After a customer cancels once the rider is dispatched but before pickup, who pays the TumaBoda cancellation fee, and is any of the pickup fee refunded?
- **Q-11** Email: Supabase SMTP (needs your own SMTP creds for production) or Resend? Resend is a paid service beyond the brief's allowed list, so I'll default to SMTP.
- **Q-12** SMS sender ID: shared neutral sender for all tenants in Phase 1, per-tenant sender IDs later?

**State transitions**
- **Q-13** Approve the 7 added states in §5.1?
- **Q-14** `collected_from_shop` and `in_transit_to_customer` are effectively the same moment. Keep both (UI shows one) or merge?
- **Q-15** After a quote expires: re-quote on request, and auto-decline after 7 days of no action?
- **Q-16** If the customer **disputes** an intake discrepancy (e.g. "the screen wasn't cracked"): does the job pause for shop_admin resolution, or can the customer only acknowledge-and-proceed or cancel (return fee payable)? This is where liability sits, so it's your call.
- **Q-17** Customer self-cancel after the deposit is paid: allowed? Deposit refund rules? (Recommendation: no self-cancel after deposit. Shop_admin cancels and records any refund.)
- **Q-18** Supplementary quote declined by the customer: continue the original scope, or stop and return?
- **Q-19** Failed return delivery (customer not home): who pays re-delivery, and is there a limit before it becomes an unclaimed device?
- **Q-20** Customer on delivery says "not as expected": just alert shop_admin and flag the job (warranty claims are Phase 3), or block auto-close?
- **Q-21** Deposit = full amount or quote total very small: allow the shop to set "no deposit below KES X"?

**Data & scope**
- **Q-22** Retention: 90-day deletion applies to **photos only**. Invoices, payments, events and audit are kept ≥ 5 years for tax. Agree?
- **Q-23** Supabase plan: PITR backups and custom SMTP need the Pro plan. Is that acceptable?
- **Q-24** Phase ordering: the brief puts CI in Phase 2, but also requires "every state transition and payment path has a test" from Phase 1. I'd like to add the GitHub Actions workflow in Phase 1 (it's small). OK?

**Brief conflicts I'm flagging**
- "Callback-driven, not polling" vs "scheduled STK status query after 2 min": resolved by making the query a safety net that calls the same idempotent confirm function (§6).
- "Photos retained 90 days then deleted" vs tax record-keeping: resolved by scoping retention to photos (Q-22).
- "Logs the customer in via a magic link": conflicts with phone-only accounts and SMS security (Q-7).
- "Rider is not a user" + "customer scans rider QR, validated via TumaBoda API": fine, but fully dependent on TumaBoda exposing a verify endpoint. The OTP fallback is built in either way.

---

## 14. Phased delivery

Each numbered item = at least one commit. Each phase ends with `docs/HANDOVER-<n>.md`.

### Phase 1: MVP the first shop can run in production (sandbox payments, Mock courier)
1. **Scaffold:** Next.js, Tailwind, shadcn/ui, next-intl, Serwist, Supabase CLI, Vitest, Playwright, ESLint/Prettier, Dockerfile, docker-compose, `.env.example`, CI workflow (pending Q-24).
2. **Schema & RLS:** all tables in §4, helper functions, storage buckets + policies. pgTAP isolation tests for every table.
3. **Core library:** state machine map + `transition_job()` + parity test, money/VAT/rounding, phone normalization, IMEI Luhn + Apple serial check, template renderer, envelope crypto. Unit tests for **every** edge in §5.2 (legal and illegal).
4. **Tenancy & branding:** host resolution, per-tenant theme, manifest, settings page (branding, fees, VAT, deposit, rounds, expiry, retention, quiet hours, provider, credentials).
5. **Auth:** phone OTP via AT sandbox hook, staff email/password + invites, TOTP, role guards, rate limits.
6. **Payments:** Daraja adapter, initiate/callback/reconcile, `confirm_payment()` RPC, receipt screen + SMS. Tests for success, cancel, timeout, insufficient funds, duplicate callback, amount mismatch, late callback after reconcile.
7. **Delivery:** interface, MockProvider, outbox worker, delivery webhook function, scheduler.
8. **Customer wizard:** device, fault, photos (offline queue), IMEI, accessories, passcode, address (Places + pin + landmark), window, review, pay.
9. **Job detail (customer):** timeline (Realtime), tracking link, QR handover scan, intake acknowledgement, quote thread, payments, drop-off choice, invoice download, rating.
10. **Technician:** Today board (kanban), job detail, intake checklist with side-by-side photos and discrepancy flow, diagnosis notes, scanner screen.
11. **Quotes & negotiation:** builder with catalogue, versions, counters, round cap, expiry, deposit calculation.
12. **Repair → dispatch:** progress updates with templates, completion checklist, final invoice + PDF + per-tenant sequence, dispatch QR, collect-at-shop path, auto-close.
13. **Notifications:** templates seeded for every transition × audience, SMS + in-app, quiet hours, short links.
14. **Shop admin:** staff, parts catalogue, refunds, basic reports (jobs by state, revenue by period, turnaround, negotiation discount, delivery spend).
15. **Seed + e2e:** Demo Repairs tenant, 1 admin, 2 techs, 3 customers, KES parts catalogue, 6 jobs across the lifecycle. Playwright happy path (book → pay → mock pickup → intake → quote → counter → accept → deposit → repair → final pay → return → rate → closed).
16. Docs: STATE_MACHINE (Mermaid), MPESA, WHITELABEL, COMPLIANCE (draft), HANDOVER-1.

### Phase 2
Real TumaBodaProvider + webhooks + QR verification, live tracking embed, scheduled reminders + unclaimed-device alerts, supplementary quote UI, ratings reports, platform admin console (tenants, fees, metrics, impersonation, payment/webhook failure monitor), retention cleanup job, production deploy runbook, TUMABODA.md, HANDOVER-2.

### Phase 3
WhatsApp channel, KRA eTIMS integration on the existing hook, tenant billing + platform fee invoicing, Swahili (`messages/sw.json`), parts inventory with stock levels, warranty tracking (default 30 days) + warranty-claim job type (skips quote and fees; needs its own transition subset), public shareable status page, HANDOVER-3.

---

## 15. Assumptions (correct any that are wrong)

1. Each shop has its **own** Daraja app/credentials and its **own** TumaBoda merchant account. The platform holds default sandbox creds for demos.
2. The platform takes no cut of M-Pesa flows in the MVP. Platform fees are only *recorded*.
3. One technician is assigned per job at a time. Unassigned jobs appear in a shared "incoming" column.
4. Pickup windows are 2-hour slots within the shop's opening hours, bookable from 1 hour ahead up to 7 days.
5. Service zones are a named list of Nairobi areas (CBD, Westlands, Kilimani, …) matched from the Places result plus a manual override, not drawn polygons (can be upgraded later).
6. Device types and model lists: a curated seed list for iPhone, iPad and MacBook models, free text for everything else.
7. Customers may have jobs at several shops, and each shop sees only its own jobs and the snapshots attached to them, never the customer's other addresses or devices.
8. Declared value for courier insurance is entered by the customer, with a suggested default per device model.
9. English only now. Every string is in `messages/en.json` from the first commit.
10. The "Demo Repairs" seed uses the MockProvider and the Daraja sandbox, and runs without any real credentials except (optionally) AT sandbox.

---

## 16. Main risks

| Risk | Mitigation |
|---|---|
| TumaBoda API lacks QR verify or webhooks | Capabilities flag, OTP fallback, polling fallback. Raise it with them early. |
| Daraja callbacks unreliable in production | Reconcile timer + idempotent confirm, and a failure monitor in the platform console |
| iOS PWA camera/storage quirks | @zxing + manual entry fallback, IndexedDB queue tested on Safari, no Background Sync dependency |
| Wildcard domains need Vercel DNS | Decide early (Q-1). Fallback: add per-tenant subdomains through the Vercel API one by one. |
| Scope size | Phase 1 has 16 committed milestones. I'll report progress after each group and stop for review at the end of the phase. |

---

**Next step:** answer §13 (a short reply per Q-number is fine) and fill in the placeholders. I'll then update this plan, write DECISIONS.md, and start Phase 1 milestone 1.
