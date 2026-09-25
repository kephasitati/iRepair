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
- **D-18 Visual theme: Apple-style, mnofu interactions.** The requested "sleek, classy, immersive" look is Apple's own
  visual language (`#f5f5f7` canvas, `#1d1d1f` ink, `#0071e3` blue, SF Pro with an Inter fallback, pill buttons, glass
  navigation, dark hero sections) carrying mnofu's interaction patterns (glass cards, an immersive gradient backdrop,
  a pulsing M-Pesa STK prompt, a green delivery timeline). Tokens live in `app/globals.css`; per-tenant primary/accent
  colours are injected as a handful of CSS variables (`lib/branding.ts`) without overriding the base Apple palette.
- **D-19 Brand: "iRepair"** (singular — went through two earlier drafts: an apple-bite mark, then a dark-tile "One
  colour.pdf" draft, before the user supplied the official mark). Official design: a blue rounded-square tile
  holding a white precision screwdriver bit (hex-drive head, shaft, tapering to a point — the tool used to open a
  phone), used either alone or beside the wordmark "iRepair" set in a bold rounded sans-serif in dark navy; the
  leading "i" is a normal two-tone letter (blue dot, navy stem), and the "i" in "...pair" is replaced by the same
  bit glyph in blue. `components/irepair-logo.tsx` exports `IRepairMark` (icon alone: favicon, tight spaces) and
  `IRepairLogo` (the wordmark, which carries its own small icon tile) — the two are used independently, not always
  paired. `public/brand/irepair-logo.svg` is the same wordmark drawing as a standalone file, used as the shop's
  uploaded logo; `public/icon.svg` reuses the icon-alone glyph as the site/app icon. **Trademark caution:** the name
  and icon-as-letterform styling still echo Apple Inc.'s product-naming conventions; before real-world use, run a
  KIPI (Kenya) trademark search and get legal sign-off. The footer already carries an Apple-trademark disclaimer
  whenever an Apple device type is enabled.
- **D-20 Default device line-up: Apple family + Android + Windows laptops.** `DEFAULT_DEVICE_TYPES` and the
  `tenant_settings.device_types` column default now ship as `{iphone,macbook,ipad,imac,android,windows_laptop}`
  (migration `0016_android_laptop_default.sql`); existing shops keep whatever they already chose. Android and Windows
  laptop repair reuse the same device tiles, icons, model suggestions and identifier help as the Apple types so the
  line-up grows without diluting the Apple-inspired visual design.
- **D-21 Model suggestions: an in-page combobox, not `<input list>`.** The native HTML `<datalist>` popup is drawn by
  the browser/OS chrome rather than the page; inside some embedded webviews (e.g. an app's built-in preview browser)
  it renders pinned to the window's top-left instead of anchored under the field. `components/booking-wizard.tsx`
  (`ModelField`) replaces it with a small absolutely-positioned `glass-card` listbox that filters as you type,
  supports arrow keys/Enter/Escape, and is always positioned correctly relative to the input.
- **D-22 Three bugs found running the app end to end, all fixed:**
  - **Sharing a device passcode blocked the booking wizard.** `tenant_keys` (the wrapped per-tenant data key,
    DECISIONS D-5) has row-level security enabled with no policy for `repairdesk_app` — intentionally, since it's a
    system secret rather than a tenant-scoped one. `lib/tenant-crypto.ts`'s `tenantKey()` used to accept the
    caller's transaction and use it for the lookup; called from a customer's or technician's own transaction, the
    `select` came back RLS-filtered to zero rows and the fallback `insert` then hit the same policy, throwing. It
    now always looks the key up through `servicePool()` (`BYPASSRLS`) regardless of the caller's transaction, so
    sharing a passcode, and revealing one at the bench, both work from any caller.
  - **"No rider has been assigned yet" on every handover scan.** Booking a courier (`bookLeg`, called for the
    `delivery.create` outbox job) only runs when something drains the `outbox` table — the resident worker process
    (`npm run worker`) or `POST /api/internal/tick`. Running only `next dev` without also starting the worker means
    no delivery ever gets a `provider_delivery_id`, so every scan legitimately has no rider to verify against. Two
    bugs in the worker script itself meant this was true even when it *was* started: (a) `worker/index.ts` is a
    plain `tsx` entry point, not a Next.js route, so nothing populated `process.env` from `.env` — `scripts/shim-
    server-only.ts` (already the first import of every Node entry point, worker and seed alike) now loads `.env`
    the same dependency-free way `scripts/seed.ts` already did; (b) `@react-pdf/renderer`'s dependency chain is
    pure ESM, including a hyphenation package with no `require()`-compatible export — fine when Next's own bundler
    resolves it for the in-app invoice PDF route, but a hard crash at import time under `tsx`'s CommonJS loader.
    `worker/tasks.ts` now imports `renderInvoicePdf` lazily inside `generateInvoicePdf`, so the rest of the worker
    (including booking couriers) no longer depends on that chain resolving. **Known residual limitation:** the
    `invoice.pdf` outbox job itself still cannot render inside the raw `tsx` worker process (same ESM chain, just
    deferred instead of avoided) — harmless in practice, since `GET /api/invoices/[id]/pdf` already regenerates the
    PDF on demand inside the correctly-bundled Next.js process if the worker hasn't produced one, and the outbox
    row backs off and eventually goes `dead` rather than looping. A production build should bundle the worker
    (esbuild/webpack) rather than run it via raw `tsx`, which would resolve this properly; tracked for the
    Dockerfile/CI work.
- **D-23 Actually deployed to Dokploy, and made the GitHub repo public to do it.** Dokploy's GitHub App integration
  didn't have access to the (then-private) repo — logging into Dokploy with the same GitHub account doesn't grant
  it access to install/authorize against arbitrary repos. An SSH deploy key was the alternative (generated, public
  half added to the repo as a read-only deploy key), but typing the matching private key into Dokploy's SSH Key
  form was auto-blocked by a credential-handling safety check; asked the user, who chose making the repo public
  over working around that block. The unused deploy key was removed afterward. `docker-compose.dokploy.yml` (D-19's
  sibling to `docker-compose.prod.yml`, no bundled `caddy`) was deployed successfully: image built, all three
  containers up, `repairdesk_app`/`repairdesk_service` roles created by hand (`db/init/00_roles.sql`'s passwords
  are dev-only, never applied in production), all 16 migrations applied, worker restarted clean against the real
  schema. Two Dokploy-specific gotchas found only by actually doing this, not documentable from their docs alone:
  its container terminal opens at `/`, not the image's `WORKDIR` (`cd /app` first, every time); and a compose
  service's domain auto-detection ("Services not found") only works *after* a deploy has run once, so the first
  domain on a fresh service needs its service name typed manually. Both now in `DEPLOY.md` §1. Left deliberately
  unfinished, by the user's own choice, not because of an unknown: the domain's DNS A record (so nothing is
  reachable yet) and S3-compatible storage credentials (so photo/logo uploads will fail once it is).
- **D-24 Onboarded the first real shop (Primefix Kenya) from the command line, and copied its catalogue in.** The
  user first chose "onboard Primefix as a standard shop" (no custom work), then asked to "copy all the data and
  products" from primefixke.com. Rather than a Primefix-specific script, two generic ops scripts that mirror what a
  shop admin can do in Settings/Parts, for shops whose admin hasn't signed in yet: `scripts/import-woocommerce.ts`
  (reads a WooCommerce store's *public, unauthenticated* Store API — no scraping, no credentials — and upserts its
  products into `parts_catalogue` keyed by SKU `WC-<id>`, so re-runs update prices and deactivate delisted items
  instead of duplicating; device family inferred from categories/name) and `scripts/shop-settings.ts` (contact,
  address, tagline/about, colours, device types — only the flags passed). Judgement calls: only repair parts
  (screens/LCDs, batteries, charging ports, cameras, keyboards — 620 of 1,235) are marked `published`; retail
  phones/laptops/watches and accessories are quote-only, because the landing page renders *every* published row
  and `publish_price_list` stays off by default anyway (one toggle in Settings → Operations turns it on, and the
  admin curates in Admin → Parts). Apple Watch/AirPods land in family `other` (no such device type in the
  booking wizard — adding one is a product decision, not an import detail). The logo was *not* uploaded: production
  has no S3 storage yet (D-23), so `logo_path` stays null until it does. Also `scripts/reinvite.ts`: the
  original invite link printed by `create-tenant.ts` was lost in this session's tooling (tokens are stored hashed,
  so it can't be re-read), and the platform console had no "resend invite" — this re-issues one without touching
  `active`, so re-inviting an already-signed-in admin can't lock them out.
- **D-25 Apple Watch is a device type.** Asked for by the user after D-24 filed Primefix's 73 watch products under
  `other`. Enum value `apple_watch` (migration 0017, after `imac`), in the Apple family for identifier validation
  (Apple serial format; cellular models' 15-digit IMEI is accepted like any other), model suggestions, where-to-find
  help, its own line icon, label, per-device SEO page, and the public price-list ordering. Added to the *default*
  line-up for new shops (it's Apple, and the launch premise is "the Apple family first"); existing shops are
  untouched — the demo tenant and Primefix were switched on explicitly. `import-woocommerce.ts` now maps watches,
  watch parts and straps to it. Fixed in passing: the per-device FAQ said "a Apple Watch" (article logic existed
  in the page heading but not in `lib/faq.ts`).

