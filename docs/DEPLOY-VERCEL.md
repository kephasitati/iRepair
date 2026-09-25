# Deploying to Vercel

The recommended production target is still a VPS with Docker (see `DECISIONS.md`, hosting choice): iRepair needs a
long-running worker process (courier booking, M-Pesa reconciliation, SMS/notification delivery, retention) that
Vercel's serverless functions can't provide, plus a Postgres database and S3-compatible object storage that Vercel
doesn't host itself. Vercel works well for a demo, a staging environment, or a low-volume shop, once three gaps are
filled in: an external Postgres, external object storage, and a Cron Job standing in for the worker. This doc covers
all three, plus what changes in behaviour versus a VPS.

## 1. External Postgres

Vercel has no built-in Postgres that supports arbitrary roles and row-level security the way this app needs (three
roles: `repairdesk_owner`, `repairdesk_app` with `NOBYPASSRLS`, `repairdesk_service` with `BYPASSRLS` — see
`db/init/00_roles.sql`). Use any managed Postgres 17 that lets you run arbitrary SQL as a superuser-ish role to
create those roles and run `db/migrations/*.sql` — Neon, Supabase (Postgres only, not its Auth/Storage), Railway, or
RDS all work.

1. Create the database, then run the three `create role` / `create database` statements in `db/init/00_roles.sql`
   against it (adjust passwords).
2. Run migrations from your machine, pointed at the new database: `DATABASE_OWNER_URL=<owner-url> npx tsx scripts/migrate.ts`.
3. Set `DATABASE_URL` (app role), `DATABASE_SERVICE_URL` (service role) as Vercel project env vars. `DATABASE_OWNER_URL`
   is only needed for migrations, not at runtime — don't add it to Vercel.

**Connection pooling matters here.** Each Vercel function instance opens its own Postgres connections (`lib/db.ts`
caches pools per warm instance, `max: 10` each); with many concurrent serverless invocations this can exceed a small
Postgres instance's connection limit fast. Use a provider with built-in pooling (Neon and Supabase both do), or put
PgBouncer in front of a self-hosted instance, and prefer the pooled connection string Vercel/your provider gives you
over the direct one.

## 2. Object storage

Already supported without changes: set `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET`, `S3_REGION`,
`S3_FORCE_PATH_STYLE` (see `.env.example`) to a Cloudflare R2 or AWS S3 bucket instead of the local SeaweedFS
container. Nothing else changes — `lib/storage.ts` already targets any S3-compatible endpoint.

## 3. The worker, as a Vercel Cron Job

`vercel.json` at the repo root already declares:

```json
{ "crons": [{ "path": "/api/internal/tick", "schedule": "*/5 * * * *" }] }
```

`GET /api/internal/tick` (also reachable via `POST`, used by a VPS's own cron/systemd timer) runs one pass of the
same outbox/notification/timer/reconciliation loop as `worker/index.ts`. Vercel automatically attaches
`Authorization: Bearer <value>` using an env var literally named `CRON_SECRET` if one exists on the project — set
that (any random string) and the route accepts it, alongside the existing `INTERNAL_CRON_SECRET` used elsewhere, so
no secret needs to live in `vercel.json` itself.

**This changes the app's responsiveness.** A resident worker (`npm run worker` / the VPS's `worker` container) reacts
within ~250ms–1s. A 5-minute Cron Job means courier booking, M-Pesa STK confirmation follow-up, SMS/WhatsApp sends and
timers only advance every 5 minutes — noticeable to a customer watching the live job page. Two more limits to know
before relying on this for anything but a demo:

- **Vercel's Hobby (free) plan only runs Cron Jobs once a day**, regardless of what `vercel.json` says — the schedule
  above needs a Pro plan (or higher) to actually run every 5 minutes.
- Each cron invocation is a single serverless function call with a timeout (10s Hobby / 60s+ Pro by default); if the
  outbox backs up, one call may not drain it all. `processOutbox`'s default `limit` (20) keeps each pass short, but a
  large backlog still takes several invocations to clear.

If near-real-time behaviour matters (it does for M-Pesa STK prompts and live delivery tracking), keep a VPS running
`worker/index.ts` even if the web app itself is on Vercel — point both at the same external Postgres. There is no
requirement that the web app and the worker live on the same host.

## 4. Multi-tenant domains

Each shop is resolved by the `Host` header (`lib/tenant.ts`) against `tenant_domains`. On Vercel:

- `PLATFORM_ROOT_DOMAIN` should be your real platform domain (e.g. `repairdesk.co.ke`), not `localhost:3000`.
- Every shop subdomain (`<slug>.repairdesk.co.ke`) or custom domain needs to be added under the Vercel project's
  **Domains** settings — Vercel does not automatically serve a domain just because a row exists in `tenant_domains`.
  A wildcard domain (`*.repairdesk.co.ke`) needs a Pro plan or higher and a wildcard DNS record pointed at Vercel.
- `PUBLIC_SCHEME` should be `https`.

## 5. Other environment variables

Everything else in `.env.example` applies unchanged: `APP_MASTER_KEY`, `MOCK_PROVIDER_SECRET` (or real Daraja/
TumaBoda/Africa's Talking credentials per shop, entered in Settings once the shop exists), `OTP_DEV_CODE` (leave
unset in production — it only exists to skip real SMS in dev). Don't set `MOCK_DELAY_SECONDS`; that's dev-only.

## 6. Deploying

This step needs your own Vercel account and can't be done on your behalf:

1. Push the repo to GitHub (already done: https://github.com/kephasitati/iRepair).
2. In the Vercel dashboard, **Add New → Project**, import that repository.
3. Add the environment variables from sections 1–5 above under **Settings → Environment Variables** before the
   first deploy (or redeploy after adding them).
4. Deploy. Vercel picks up `vercel.json`'s Cron Job automatically.
5. Add your platform domain and any shop domains under **Settings → Domains**.
6. Run `npx tsx scripts/seed.ts` once against the new database if you want the demo tenant, or create a real shop
   through the platform console (`/platform/tenants/new`) instead.
