# iRepair

A white-label, mobile-first platform for device repair shops in Nairobi: a customer books a pickup, a TumaBoda rider
collects the device, a technician diagnoses and quotes it, the customer pays by M-Pesa, and a rider brings it back —
every step scanned, photographed, and visible to the customer live. One deployment can run any number of
independently-branded shops (`docs/WHITELABEL.md`).

<p>
  <img src="public/brand/irepair-logo.svg" alt="iRepair" height="48" />
</p>

## Stack

Next.js 16 (App Router, Turbopack), React 19, Tailwind v4, shadcn/ui, next-intl · plain PostgreSQL 17 with
row-level security (no Supabase) via `postgres.js` · S3-compatible object storage (SeaweedFS locally, Cloudflare R2
or AWS S3 in production) · Safaricom Daraja (M-Pesa STK) · Africa's Talking (SMS) · a small vendor-neutral courier
interface with a working mock provider and a TumaBoda adapter skeleton · Vitest + Playwright.

Read `docs/DECISIONS.md` before assuming this behaves like a Next.js app you've seen before — several defaults
(hosting, the database, the courier) were deliberately changed partway through the build; `AGENTS.md` also points at
the bundled Next.js docs for anything version-specific.

## Quick start (local dev)

```bash
cp .env.example .env
# fill in APP_MASTER_KEY, INTERNAL_CRON_SECRET, MOCK_PROVIDER_SECRET — see the comments in .env.example

docker compose up -d postgres s3      # Postgres 17 + SeaweedFS (S3-compatible), local dev only
npx tsx scripts/migrate.ts            # apply db/migrations/*.sql
npx tsx scripts/seed.ts               # demo shop, staff, customers, six jobs — prints fresh login details

npm run dev                           # web app  — http://demo.localhost:3100 (see PLATFORM_ROOT_DOMAIN in .env)
npm run worker                        # background jobs — courier booking, M-Pesa reconciliation, notifications,
                                       # retention. Nothing in the app "just works" without this also running.
```

`npx tsx scripts/seed.ts` prints fresh demo credentials **every time it runs**, including a new platform-admin TOTP
secret — always read the block it just printed, not one from an earlier run.

## Testing

```bash
npm run typecheck
npm test              # vitest: unit (state machine, money, phone/IMEI) + DB (RLS, transitions, payments)
npm run test:e2e       # playwright: the full customer happy path, legal pages, SEO surface
```

`tests/db` runs against its own `repairdesk_test` database (created by `db/init/00_roles.sql`) and resets its schema
on every run — never point `TEST_DATABASE_OWNER_URL` at a database you care about.

## Project structure

```
app/                 Next.js routes: (shop) customer app, admin (shop staff), platform (operator console),
                      bench (technician), api (webhooks, SSE, internal endpoints)
components/          UI, in the Apple-inspired theme (DECISIONS D-18) plus the official iRepair brand (D-19)
lib/
  core/              Pure logic: state machine, money/VAT, phone/IMEI, crypto, templates — unit-tested in isolation
  jobs/              The job domain: booking, quotes, logistics, payments, intake, notifications
  providers/         M-Pesa, courier (mock + TumaBoda skeleton), SMS, email — one interface, swappable per shop
db/
  migrations/        Applied in order by scripts/migrate.ts; 0002 is generated — see scripts/gen-state-machine.ts
  init/               Postgres role bootstrap for local dev (docker-entrypoint-initdb.d)
worker/              The resident background process (outbox, timers, notifications, retention, courier polling)
tests/               unit/ (no DB), db/ (against repairdesk_test), e2e/ (Playwright, against a real running app)
docs/                Everything below
```

## Documentation

| Doc | What's in it |
| --- | --- |
| [`PLAN.md`](docs/PLAN.md) | The original architecture and scope brief |
| [`DECISIONS.md`](docs/DECISIONS.md) | Every decision made during the build, including bugs found and fixed |
| [`STATE_MACHINE.md`](docs/STATE_MACHINE.md) | The 30-state job lifecycle, as a Mermaid diagram |
| [`MPESA.md`](docs/MPESA.md) | How STK push payments actually work, end to end |
| [`TUMABODA.md`](docs/TUMABODA.md) | Courier integration status — a skeleton, waiting on their API docs |
| [`WHITELABEL.md`](docs/WHITELABEL.md) | How multi-tenant white-labelling works, and what a shop configures itself |
| [`COMPLIANCE.md`](docs/COMPLIANCE.md) | Data protection: what's collected, encrypted, retained, and why |
| [`DEPLOY.md`](docs/DEPLOY.md) | Production deploy: Dokploy/Coolify or a bare VPS with Docker + Caddy |
| [`DEPLOY-VERCEL.md`](docs/DEPLOY-VERCEL.md) | The Vercel alternative, and why it's a weaker fit for this app |
| [`HANDOVER-1.md`](docs/HANDOVER-1.md) | Phase 1 status: what's done, tested, and known gaps |

## Deploying

Push to `main`; `docker build -f Dockerfile .` produces one image used for both the web server and the worker
(different `command:` in `docker-compose.prod.yml`). See `docs/DEPLOY.md` for Dokploy (recommended) or a bare VPS,
and `docs/DEPLOY-VERCEL.md` if you specifically want Vercel despite its Cron-frequency trade-off.
