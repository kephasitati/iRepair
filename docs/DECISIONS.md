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
- **D-26 A shop can have a product catalogue page and its own FAQ.** The user's "copy all the stuff" from
  primefixke.com meant more than a price list: the site is a WooCommerce store with photos and descriptions, and
  has its own FAQ. Asked which gaps to close; chose all three (products page, logo once storage exists, custom FAQ).
  Built generically, not for Primefix: `parts_catalogue` gains `listed`, `category`, `description`, `image_path`
  (our copy in private storage, served by `/api/products/<id>/image`) and `image_url` (the source website's photo,
  used until a copy exists — so the shop page works *before* S3 is configured, which production still lacks);
  `tenant_settings.shop_page` gates a public `/shop` (family + category filters, 48 per page, Product/ItemList
  JSON-LD, in the sitemap) and `/shop/<id>` (WhatsApp "ask about this" prefilled with the product; "Book this
  repair" only for repair parts of an enabled device type); Admin → Parts edits all of it including a photo
  upload. `tenant_faqs` (RLS like the catalogue) replaces the generated FAQ on the landing page and llms.txt when
  non-empty — the per-device pages keep their generated, price-aware FAQs; edited as plain `Q:`/`A:` blocks in
  Settings (one textarea is the whole list, so it's trivially re-orderable) or `scripts/set-faqs.ts`. Importer:
  `--list-all` (list existing rows too — flags are otherwise the admin's, so a re-import never re-lists something
  they hid) and `--copy-images` (downloads every photo into our storage; run it once S3 exists). Primefix's 14
  FAQs were copied nearly verbatim; two answers were adjusted where iRepair changes the facts (online booking
  exists now; repairs are tracked live in the account). Not built: a cart/checkout — orders go through WhatsApp,
  exactly as on their current site, and payments here are for repairs only (money flow untouched).
- **D-27 Admin → Products & parts is the products backend.** The user asked for admins to "add the products on
  the backend"; they already could, but the page was called "Parts catalogue" and rendered all 1,235 rows in one
  list. Rebuilt as a searchable, filterable (device family, category, Shop / price list / added-by-hand / inactive),
  paginated (50) list with thumbnails and a clearly labelled "Add a product or part" form; nav entry renamed
  "Products". Still one table underneath: a retail product and a quote line are the same row with different
  flags, which is what lets a screen sold in the shop also be the part a technician quotes.
- **D-28 Admin → Staff, exercised element by element, found broken twice over.** (1) The page crashed on load:
  `renderSuccess={(d) => …}` passed a function from a server page into the client `ActionForm` — React refuses
  ("Functions cannot be passed directly to Client Components"). Replaced with a serialisable `successKind="invite"`
  flag; the platform console's New-shop page had the identical bug. (2) Every `<Button>` inside a bare
  `<form action={serverAction}>` was `type="button"` (the shadcn/Base UI default), so role changes, deactivation,
  the account page's delete buttons and two platform-console actions never submitted — six forms across the app,
  all now `type="submit"`. Also fixed while there: an invalid phone on the invite form was silently dropped (now an
  error), a phone already on another account would have surfaced as a raw unique-constraint error (now a message),
  "1 open jobs", and a pending invitee showed "Reactivate" (which would mark them active with no password) — now
  "Revoke invite", which clears the token so the link 404s, plus the invite's expiry date. Verified in the browser:
  validation messages, invite link creation and acceptance page, revoke → dead link, role toggle both ways,
  deactivate → reactivate. **Lesson, again (D-22):** both bugs were invisible to the type checker and the test
  suite; the page had simply never been opened after the form component was refactored.
- **D-29 Admin → Settings, exercised element by element.** All six sections (branding, contact & hours, fees,
  operations, FAQ, integrations) were driven in the browser with invalid and valid input and checked after a
  reload and on the public landing page. Worked as built: every numeric/percentage limit, KRA PIN format, VAT-
  without-PIN, phone/WhatsApp formats, device-type minimum, FAQ format, Daraja/courier/SMS required fields,
  persistence of every field, and the landing page picking up FAQ, price list and warranty changes. Fixed: opening
  hours with a closing time at or before opening were silently saved as "closed that day" (now an error naming the
  day); non-numeric or out-of-range latitude/longitude would have been stored (Postgres accepts `NaN` for double
  precision) — now validated, and lat/lng must come as a pair; an empty address was accepted. Added: a "Remove
  saved credentials" button per integration — the action already supported `clear=1` but nothing in the UI sent
  it, so a shop could never go back to platform defaults once it had entered a key. Not testable in the embedded
  browser: the logo/icon file inputs (no file-upload capability there); the same code path was exercised by
  `scripts/set-logo.ts` locally and by the earlier seed uploads.
- **D-30 Identify a booking by the customer's ID document, and consultation fees per device type.** Asked for by
  the user (2026-09-28) with three other features (D-31, D-32). Decisions confirmed before building: the ID is
  *kept on the customer's account for that shop* (their choice over purge-at-close — more DPA exposure, so: number
  encrypted with the tenant key like passcodes, photo in private storage behind a signed URL, every staff view of
  the photo audited, the customer can delete it from Account, and staff never see the full number — only the last
  four plus the photo); fees are per device type with the shop-wide fee as fallback, captured on the job at booking
  as before, credited rule unchanged. Step 2 now requires *either* a valid IMEI/serial *or* an ID (national ID,
  passport, alien ID; loose format checks — the number is matched by eye against the photo, never used as a key);
  step 3 requires a photo of that document before the wizard continues. A saved ID is offered for reuse on the next
  booking; entering a different number invalidates the old photo. Intake still asks the technician to read the
  device's IMEI/serial; with no declared identifier there is simply nothing to mismatch against. Verified in the
  browser as a customer (OTP sign-in, step 2 gating, invalid-number message, ID photo upload, account page,
  signed-URL redirect) and in the database (encrypted number, `identity_method = 'id'`, fee on the job).
- **D-31 Categorised public price list; social profiles and an About page with Instagram posts.** The published
  price list (landing page and per-device pages) now groups items by the shop category the catalogue already
  carries (device → category → items; uncategorised items last under "Other"). Socials: per-shop links (Instagram,
  Facebook, TikTok, X, YouTube, website) set in Settings → Branding, shown in the footer and on `/about`, and given
  to search engines as `sameAs` and to AI assistants in llms.txt. The user asked for "an Instagram feed on an About
  tab": an automatic feed needs a Meta developer app and a per-shop token that expires every 60 days, so the first
  version is token-free — the shop pastes up to 12 post/reel links, rendered with Instagram's official embed.
  Privacy: embed.js sets Instagram cookies, so it is never loaded on page view; visitors click "Show Instagram
  posts" first. The token-based auto-feed is the follow-up if a shop wants it. `/about` also carries the address,
  hours, contact channels and device line-up, and is in the header, footer and sitemap.
- **D-32 A light CRM: customers, notes, tags, follow-ups.** Scope chosen by the user: customer list + history +
  notes, plus follow-up reminders; explicitly *not* bulk SMS/WhatsApp campaigns (consent tracking and paid SMS —
  ask before building). A "customer" is anyone with a job at this shop, so there is no separate contacts table to
  drift from the real data: the list is derived from `jobs`, `payments` (successful, in KES) and the three small
  CRM tables (`customer_notes`, `customer_tags`, `customer_followups`, all tenant-scoped with staff-only RLS).
  Lives under `/bench/customers` rather than `/admin` so technicians can read and add notes too; CSV export is
  admin-only and audited (personal data leaving the system). Due follow-ups surface on the board and as a filter on
  the list; completing one records who and when. Verified in the browser on the demo shop: list, search, tag,
  note, schedule → board panel → done, CSV.
- **D-33 Admin QA pass, all pages.** After D-28/D-29 (Staff, Settings) the remaining staff pages were driven the
  same way on the demo shop: Board (all/mine, follow-up panel), job page (loads, assign control present), Scanner
  (renders), Customers (D-32), Reports (7/30/90 days), Products (add with photo/category/listed → search → edit
  price → retire → inactive filter), Refunds (unknown job, over-refund, zero, non-numeric, valid → history + audit),
  Unclaimed (rows link to jobs), Messages (bad variable rejected, save → "customised", reset → default), Audit
  (shows refund/note/template/export actions), Settings (new per-type fees incl. an explicit 0, https-only social
  links, Instagram post validation and normalisation). Nothing needed fixing this time; two false alarms were my
  own test scripts (a navigation mid-script, a stale error read). Not checkable without a camera or a real
  handover: the QR scanner's camera path and the job page's state transitions — those are covered by the
  Playwright happy path, which drives them through the same server actions.
- **D-34 Dispatch waits for a shop admin (state-machine change).** Asked for by the user; options put to them before
  building because it changes a transition. Chosen: *one payment, admin gate* — the customer still picks drop-off
  and pays repair + delivery in one M-Pesa payment, but the repaired device now stops in `dispatch_pending` instead
  of booking the courier instantly; a shop admin (or platform support) presses "Request TumaBoda rider" once it is
  packed, which moves it to `return_requested` and the outbox books the rider as before. Collection at the shop is
  still automatic. Technicians see the job but can't release it. Migration 0020 updates `job_transitions` and
  redefines `transition_job` (the only change: `dispatch_pending` is no longer momentary for delivery); 0002 was
  regenerated from the TS table by `npm run gen:state-machine` as the project's guard test requires, so fresh and
  migrated databases agree. The declined/cancelled return path (return fee paid → rider booked) is unchanged — say
  if that should be gated too. Customers see "Payment received — the shop is packing your device"; staff see the
  delivery address, window and paid delivery fee. Covered by the DB transition test and the Playwright happy path.
- **D-35 Staff workflow and navigation, phone-first.** Every bench job now shows a stage bar (Pickup → Intake →
  Diagnose → Quote → Deposit → Repair → Payment → Dispatch → Delivery → Done) and a "next step" banner saying whose
  move it is (you / admin / customer / TumaBoda) in plain words (`lib/core/workflow.ts`). The phone bottom bar was
  broken by D-32 (five items in a four-column grid) and never gave admins Products, Staff, Refunds etc. on a phone:
  it is now Board · Scanner · Customers · Menu, with a Menu page listing every screen, and the current screen is
  highlighted in both bars.
- **D-36 Public pages on a phone.** The price list shows each category as a collapsed row ("Screen Replacement ·
  61 items · from KES 2,500") on the landing and device pages; the Shop's 30-odd category chips sit behind one
  "Categories" toggle and no longer wrap mid-word. Fixed in passing: price-list rows were keyed by product name, and
  Primefix has duplicate names, so React could drop rows. Live tracking: the rider card's link is now a full-width
  "Track live on TumaBoda" button opening the courier's own tracking URL (the mock courier's is local).
  Swept every public and staff page at 375 px: no horizontal overflow.
- **D-37 Extra domains with their own landing page; Google reviews.** `tenant_domains.landing_path` lets a domain
  open a specific page — for Primefix, primefixke.com → home and phoneparts.co.ke → Shop (the user: "leave it
  Primefix for now", i.e. both are Primefix). Set from the platform console or `scripts/add-domain.ts` (which also
  registers `www.`); the domains still need DNS pointed at the server and rows in Dokploy, and pointing
  primefixke.com replaces the current WordPress site. Google reviews on About, after Instagram: shop enters its
  Google Place ID; with a server `GOOGLE_PLACES_API_KEY` (Places API New) the page shows the rating, count and up to
  five recent reviews with Google's attribution, refreshed at most every six hours; without a key it still shows
  "Read all reviews" / "Write a review" links. Primefix's Instagram set to its real profile.
- **D-38 Two user-reported bugs.** (1) *"When I choose passcode and share, I can't proceed."* A saved draft's
  passcode is stored encrypted and never sent back to the browser, so coming back to step 2 (reload, Back, or
  reopening the booking) showed an empty passcode box and the server rejected Next with "Enter the passcode" —
  stuck. A blank box on a draft that already has a passcode now means "keep it" (server and client), the field says
  so, and whenever Next is disabled the wizard lists what is still needed (IMEI/serial or ID number, passcode).
  (2) *"Instagram not showing under About."* The section only rendered when specific posts were chosen; it now shows
  a profile card (@handle, Follow) whenever the shop has an Instagram link, with any chosen posts below it. Also:
  0020's Place ID check used a regex bound of 300, above Postgres's 255 limit, so saving any Place ID failed —
  0021 replaces the check. Primefix's Google Place ID (verified against its Maps listing) and map pin are set.

