# Handover: Phase 1

Everything below is the state of the repo as of this handover, not a plan — see `docs/PLAN.md` for the original
brief and `docs/DECISIONS.md` for every decision made along the way (including three real bugs found and fixed by
actually running the app end to end, D-22).

## What's built and working

- **The full job lifecycle**, 30 states, enforced identically by TypeScript and Postgres (`STATE_MACHINE.md`) — draft
  through pickup, diagnosis, quoting and negotiation, deposit, repair, dispatch, return, and closing (or a decline/
  cancel path at almost every point).
- **Payments**: M-Pesa STK push (real Daraja adapter, plus a local simulator that exercises the exact same confirm/
  transition/invoice code — `MPESA.md`), idempotent confirmation, amount-mismatch protection, an invoice with a
  proforma stage and a numbered tax invoice on payment, and a PDF for it.
- **Delivery**: a vendor-neutral `DeliveryProvider` interface, a fully-working stateless `MockProvider`, and a
  structurally-complete `TumaBodaProvider` skeleton waiting on their API documentation (`TUMABODA.md`) — every
  `TODO(TUMABODA)` is a placeholder for a real endpoint, not a missing feature of the app itself.
- **Multi-tenant white-labelling**: any number of shops, each with its own domain, branding, prices, device
  line-up, fee rules and credentials, resolved by `Host` header with row-level security enforcing the boundary
  (`WHITELABEL.md`).
- **Customer app**: phone-OTP sign-in, the booking wizard (device → identifier/passcode → photos → address → pay),
  job timeline, rider QR/OTP handover scanning, quote negotiation, invoice/payment, rating.
- **Technician bench**: a kanban board, intake checklist with discrepancy handling, diagnosis, quote builder,
  progress updates, completion checklist, dispatch scanning, counter collection.
- **Shop admin**: settings (branding, contact, devices, fees, credentials), staff management, parts catalogue,
  refunds, reports, audit log.
- **Platform console**: shop list and metrics, new-shop creation with an admin invite link, suspend/reactivate,
  custom domains, support-mode impersonation (audited, time-boxed), a failures monitor (dead outbox jobs, webhook
  errors, stuck payments, failed SMS).
- **SEO/AEO/GEO**: per-device landing pages, JSON-LD (LocalBusiness, FAQPage, Service, BreadcrumbList), a visible
  FAQ, `robots.txt`, `sitemap.xml`, a generated Open Graph image, and `/llms.txt` for AI assistants — all generated
  from each shop's real settings and prices, so they can't drift from what the app actually enforces.
  WhatsApp click-to-chat on every customer page.
- **Legal/consent**: terms acceptance recorded per job and enforced by a DB trigger, a cookie consent banner and
  record, a privacy policy and terms page referencing TumaBoda by name.
- **Security and compliance controls**: envelope-encrypted passcodes purged on job close, RLS on every table, an
  audit log for every staff mutation, TOTP for platform admins, private storage with signed URLs only, rate-limited
  OTP/STK — see `COMPLIANCE.md` for the full list with pointers to the enforcing code.
- **Deployment**: a working multi-stage `Dockerfile`, `docker-compose.prod.yml` (bare VPS, Caddy on-demand TLS) and
  `docker-compose.dokploy.yml` (Dokploy/Coolify, no bundled proxy) — **actually deployed and running** this session
  on the user's own Dokploy instance (project "iRepair", `irepair.tumaboda.co.ke`): image built, all three
  containers (`postgres`, `web`, `worker`) up, roles created, all 16 migrations applied, worker confirmed running
  clean against the real schema. `DEPLOY.md` §1 documents the exact steps and the Dokploy-specific gotchas found
  doing this for real (private-repo access, manual service-name entry for the first domain, the terminal's working
  directory). Outstanding before it's reachable: the domain's DNS A record hasn't been pointed at the server yet,
  and no S3-compatible storage is configured (photo/logo uploads will fail until one is added) — both deliberate,
  user-deferred choices, not unknowns. A documented (though architecturally weaker — see below) Vercel path exists
  in `DEPLOY-VERCEL.md`, not used for the real deployment.

## Testing

- **182 vitest tests** (unit + DB-against-a-real-Postgres), covering every legal and illegal state transition, money/
  VAT rounding, phone/IMEI validation, and RLS boundaries between tenants.
- **4 Playwright end-to-end tests**: the full customer happy path (book → pay → mock pickup → intake → quote →
  counter-offer → accept → deposit → repair → final pay → return → closed with an invoice PDF), cookie consent and
  the legal pages, the device line-up, and the SEO surface (per-device pages, `robots.txt`, `sitemap.xml`,
  `/llms.txt`).
- A GitHub Actions workflow (`.github/workflows/ci.yml`) runs both suites on every push/PR — **not yet actually run
  on GitHub** (this session couldn't trigger a real Actions run), so treat it as carefully-written-but-unverified
  until its first real run; typecheck and the two test jobs are written to be self-contained (they provision their
  own Postgres role/database), the e2e job additionally starts its own SeaweedFS S3 stand-in.

## Real bugs found this session by actually running the app, not just testing it

Discovered by driving the app end to end in a browser rather than through the (passing) test suite alone. All fixed,
all detailed in `DECISIONS.md` D-22 and the Docker-specific ones below:

1. Sharing a device passcode silently failed and blocked the booking wizard (an RLS design was violated by an
   incidental code path).
2. The background worker (courier booking, payment reconciliation, notifications) couldn't start at all —
   `.env` was never loaded by the plain `tsx` entry point, and separately, `@react-pdf/renderer`'s ESM-only
   dependency chain crashed under `tsx`'s CommonJS loader.
3. A native `<datalist>` used for model suggestions opened its suggestion popup in the wrong place inside this
   session's embedded preview browser — replaced with an in-page combobox.
4. Building the actual Docker image (not just `npm run build` on a machine that already has secrets in its shell)
   surfaced two more: `next build` needed real secrets just to statically prerender the offline-fallback page (root
   layout's tenant resolution ran during the build), and `output: 'standalone'` was configured but nothing in the
   image actually served from the standalone output correctly (`next start` warns it doesn't work with that
   config) — both fixed; see `DECISIONS.md` and the Dockerfile's own comments.

**Takeaway for whoever picks this up next: a green test suite did not mean the app actually ran.** All of the above
passed vitest and Playwright before being found. Actually starting the worker, and actually building the production
Docker image, caught what the test suite structurally couldn't (it never starts a second process, and it never runs
a real `docker build`). Do both again after any change that touches `lib/env.ts`, `worker/`, `next.config.ts`, or
adds a new required environment variable.

## Known gaps, honestly

- **TumaBoda is a skeleton, not an integration** (by design, per the original brief — their API docs weren't
  available). Every shop should stay on the mock/simulated courier until `TUMABODA.md`'s "what's needed" list is
  filled in by whoever gets their real documentation.
- **~16 pre-existing ESLint errors** (mostly `react-hooks` rules in `components/photo-capture.tsx` and
  `components/qr-scanner.tsx`, plus two `no-unused-expressions` in a test file) — found while wiring up CI this
  session, not fixed (out of scope for this pass). `npm run lint` in CI is currently `continue-on-error: true`
  because of this; fix these and remove that flag.
- **Custom domains aren't DNS-verified** before taking effect (`WHITELABEL.md`) — only a platform admin can add one
  today, which is the real control, but there's no ownership-proof step.
- **The invoice-PDF outbox job can't render inside the standalone `tsx` worker process** even after this session's
  fix (which only deferred the failure, not eliminated it) — harmless in practice since the on-demand download
  route regenerates it correctly inside the properly-bundled Next.js process; see `DECISIONS.md` D-22. Fixing this
  for real means bundling the worker (esbuild/webpack) instead of running it via raw `tsx` in production.
- **Vercel's Cron Jobs are a materially worse fit than a resident worker** for this app (once-daily on the free
  plan; even paid, a 5-minute-or-slower poll instead of sub-second reactions to a payment or courier update) — fine
  for a demo, not recommended for a real shop. See `DEPLOY-VERCEL.md`.
- **Brand and trademark risk, unresolved**: the current name and mark haven't been cleared with KIPI (Kenya) or a
  lawyer — see `DECISIONS.md` D-19 and `COMPLIANCE.md` §9. Don't use this commercially as-is.
- **Phase 2/3 items not started**: real TumaBoda webhooks, live tracking embed, scheduled reminder/unclaimed-device
  alerts beyond what the worker already fires, supplementary-quote UI polish, ratings reports, WhatsApp as a
  notification *channel* (the click-to-chat button exists; outbound WhatsApp messages don't), KRA eTIMS (the hook
  columns exist in `invoices`, nothing calls it), tenant billing/platform-fee invoicing (the ledger is written,
  nothing invoices it), Swahili, parts inventory levels, warranty-claim job type, a public shareable status page.

## Command-line shop onboarding (used for the first real shop)

Primefix Kenya (`primefix.irepair.tumaboda.co.ke`) was onboarded on the live deployment entirely from the
container terminal, since the platform console isn't reachable until DNS points at the server — `DECISIONS.md`
D-24. The scripts are generic and documented in `DEPLOY.md` §1 step 11: `scripts/create-tenant.ts` (new shop +
admin invite), `scripts/reinvite.ts` (re-issue a lost invite), `scripts/shop-settings.ts` (Settings fields as
flags) and `scripts/import-woocommerce.ts` (a WooCommerce store's public catalogue into Admin → Parts; Primefix's
1,235 products came in this way with photos and descriptions, listed on its `/shop` page, repair parts also marked
for the price list) and `scripts/set-faqs.ts` (its 14 FAQs, kept in `scripts/data/primefix-faqs.txt` as the
onboarding record). `DECISIONS.md` D-25/D-26 cover the Apple Watch device type and the shop/FAQ features that
came out of it.

## Access, for whoever picks this up

- Demo tenant: `npx tsx scripts/migrate.ts --reset && npx tsx scripts/seed.ts` prints fresh demo credentials every
  time it runs, **including a new platform-admin TOTP secret** — don't reuse credentials from an old terminal
  scrollback or an old chat transcript; reseed and read the freshly printed block.
- Local dev needs three processes: `npm run dev` (web), `npm run worker` (background jobs — courier booking, M-Pesa
  reconciliation, notifications, retention; nothing in the app "just works" without this one running), and
  `docker compose up -d postgres s3` for the database and local S3-compatible storage.
- Repository: https://github.com/kephasitati/iRepair
