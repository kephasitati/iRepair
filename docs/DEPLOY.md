# Deploying iRepair (VPS + Docker)

This is the recommended production path (see `DECISIONS.md`, hosting choice): a persistent worker process, your own
Postgres and no per-invocation limits. `docs/DEPLOY-VERCEL.md` covers the alternative if you specifically want
Vercel, along with why its Cron Jobs are a worse fit here (once-daily on the free plan, and even on a paid plan a
5-minute-or-slower poll instead of the resident worker's sub-second reaction to a payment or courier update).

Two ways to run it: a Docker PaaS (**Dokploy**, Coolify, CapRover — recommended, easiest) or a bare VPS with
`docker compose` and Caddy driving TLS yourself. Both use the same image (`Dockerfile`) and the same environment
variables; only who runs the reverse proxy differs.

## 0. What you need first

- A VPS (2 vCPU / 4 GB RAM is plenty to start) — DigitalOcean, Hetzner, Linode all work.
- A domain you control, with its DNS delegated to wherever you'll point records (e.g. `A example.com` and
  `A *.example.com` at the server's IP, if you want shops on subdomains of your own platform domain).
- The values in `.env.example`, filled in for real: `APP_MASTER_KEY` (generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — must be at least 40 characters,
  that command's output is 44), `INTERNAL_CRON_SECRET` and `MOCK_PROVIDER_SECRET` (any random string, at least 16
  characters each — `lib/env.ts` enforces both minimums and refuses to boot otherwise), Daraja/TumaBoda/Africa's
  Talking credentials (or leave the driver as `simulator` until a shop configures its own in Settings — each shop's
  own credentials are stored encrypted per-tenant, not as platform-wide secrets), and Cloudflare R2 or AWS S3
  credentials for the `S3_*` variables in `.env.example`.
- **Never commit these.** Keep them in `.env.production` on the server (gitignored) or in your PaaS's own secrets UI.

## 1. Option A — Dokploy (or Coolify / CapRover)

These manage the reverse proxy, TLS and domains for you, so the deploy is close to "point it at the repo and add
env vars":

Verified end to end against a real Dokploy instance (project "iRepair", `irepair.tumaboda.co.ke`) — the steps below
reflect what actually happened, including the parts the Dokploy UI doesn't make obvious.

1. Push this repo to GitHub (already done: https://github.com/kephasitati/iRepair). **The repo must be public, or
   Dokploy's Git provider needs a deploy key** — Dokploy's own GitHub App integration doesn't grant access just
   because you're logged in with the same account; if it can't find the repo when you pick a GitHub account in the
   Git provider form, either make the repo public or add an SSH deploy key (Dokploy → Settings → SSH Keys, and the
   matching public key as a read-only deploy key on the GitHub repo), then select it under the compose's "Git"
   provider (not "GitHub") with the repo's plain `https://github.com/...` clone URL.
2. In Dokploy, create a new **Compose** service (not "Application" from a single Dockerfile — you want the
   multi-service stack) pointing at this repo, using **`docker-compose.dokploy.yml`** as the compose file — not
   `docker-compose.prod.yml`, which bundles a `caddy` service that would fight Dokploy's own Traefik for ports 80/443.
3. Set every variable from `.env.example` (with real values) plus `POSTGRES_OWNER_PASSWORD`,
   `POSTGRES_APP_PASSWORD`, `POSTGRES_SERVICE_PASSWORD` (three different strong passwords) in the service's
   **Environment** tab — Dokploy writes these to a `.env` file in the deploy context, which
   `docker-compose.dokploy.yml` loads via `env_file: .env` on both `web` and `worker`. Also add `NODE_ENV=production`
   and `PORT=3000` there (Dokploy's Environment tab starts with these two by default; keep them).
4. **Add the domain before or after deploying** (Domains tab → Add Domain): Dokploy's service-name auto-detection
   ("Services not found") only works after it has parsed a deployed compose, so on a first setup click **Manual**
   and type the service name (`web`) yourself, Host = your domain, Container Port = `3000`, HTTPS on, Certificate
   Provider = Let's Encrypt.
5. Deploy. Dokploy builds the image from `Dockerfile` for both the `web` and `worker` services — expect several
   minutes on a fresh server (no layer cache yet, two images built from the same Dockerfile).
6. **One-time role setup** (Dokploy doesn't run `db/init/00_roles.sql` automatically — that file's passwords are
   dev-only): once `postgres` is running, open **Terminal** on it from the Containers tab and run:
   ```sql
   psql -U repairdesk_owner -d repairdesk
   create role repairdesk_app login password '<POSTGRES_APP_PASSWORD>' nobypassrls;
   create role repairdesk_service login password '<POSTGRES_SERVICE_PASSWORD>' bypassrls;
   ```
   using the same passwords as step 3.
7. **Run migrations** from a terminal on the **`web`** container (Containers tab → `web` → Terminal → `/bin/sh`,
   Alpine has no `bash`) — **`cd /app` first**: Dokploy's terminal drops you at `/`, not the image's `WORKDIR`, and
   `npx tsx scripts/migrate.ts` from the wrong directory fails to resolve the script path.
   ```sh
   cd /app && DATABASE_OWNER_URL=postgres://repairdesk_owner:$POSTGRES_OWNER_PASSWORD@postgres:5432/repairdesk npx tsx scripts/migrate.ts
   ```
   (`$POSTGRES_OWNER_PASSWORD` is already in the container's own environment — no need to retype it.)
8. **Restart the `worker` service** after migrations if it started before they were applied — it will have been
   erroring every tick ("relation ... does not exist") and self-heals cleanly once restarted against a real schema;
   check its logs to confirm no errors after the restart.
9. Point the domain's DNS at the server (an A record to the Dokploy host's IP; find it by resolving whatever
   hostname the Dokploy dashboard itself runs on, if you don't already have the server's IP handy) — the domain row
   added in step 4 only routes traffic *once DNS actually resolves there*; Let's Encrypt issuance also waits on this.
10. Add more shop domains the same way as shops sign up — `tenant_domains` rows in the database only decide which
    *shop* a hostname resolves to once traffic already reaches the app via a domain Dokploy knows about.
11. Visit `https://<your-platform-domain>/platform` and sign in (create the first platform admin by inserting a row
    directly, or via `npx tsx scripts/seed.ts` if you want the demo tenant as a starting point instead of a bare
    platform).

## 2. Option B — bare VPS, `docker compose`, Caddy on-demand TLS

1. SSH in, install Docker and the Compose plugin.
2. `git clone https://github.com/kephasitati/iRepair.git && cd iRepair`
3. Copy `.env.example` to `.env.production` and fill in real values, plus the three Postgres passwords used below.
4. `docker compose -f docker-compose.prod.yml up -d postgres`, wait for it to be healthy, then run the one-time
   role setup and migrations exactly as steps 6–7 above (`docker compose exec postgres psql -U repairdesk_owner -d repairdesk`
   for the roles; `DATABASE_OWNER_URL=... npx tsx scripts/migrate.ts` from your own machine or a throwaway
   container with network access to `postgres`).
5. `docker compose -f docker-compose.prod.yml up -d --build` — this builds and starts `web`, `worker` and `caddy`.
6. Point your domain's DNS at the server. Caddy requests a certificate **on demand**, per hostname, the first time
   it sees that `Host` header — gated by `GET /api/caddy/ask` (`app/api/caddy/ask/route.ts`), which only returns
   `200` for hostnames already present in `tenant_domains` for an active tenant. This is what lets a white-label
   shop bring an arbitrary custom domain without you pre-listing it in a static Caddyfile.
7. Same last step as above: visit the platform console and create the first shop.

## 3. After the first deploy

- **Backups:** `pgdata` is a named Docker volume; schedule `pg_dump` (or your VPS provider's volume snapshots) —
  nothing else here does this for you.
- **Updates:** `git pull && docker compose -f docker-compose.prod.yml up -d --build` (or push to the branch Dokploy
  watches) rebuilds and restarts `web` and `worker`; run any new files in `db/migrations/` with `scripts/migrate.ts`
  first, since neither service applies migrations automatically on boot.
- **Retention and the outbox:** the `worker` service is what runs the 90-day photo retention sweep, quote expiry,
  and outbox retries — if you ever stop it (e.g. a Dokploy misconfiguration removes the service), those all stop
  silently rather than erroring loudly, so make sure it shows healthy after any change.
- **Monitoring:** `/platform/monitor` (platform console) surfaces dead outbox jobs, webhook errors, stuck payments
  and failed SMS — check it after a deploy, and periodically otherwise.
