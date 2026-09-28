<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working in this repo

Hard-won things that are not obvious from the code. How code is written here is in `docs/CONVENTIONS.md`; why the
system behaves as it does is in `docs/DECISIONS.md`.

## Production is Dokploy, and deploying code is not the whole deploy

Panel: `https://dokploy.tumaboda.co.ke`, project iRepair (services `web`, `worker`, `postgres`). A deploy is started
from the panel. **Neither service runs migrations on boot.** After any deploy that adds a file to `db/migrations/`,
run them from the `web` container before anyone uses the site:

```sh
cd /app && DATABASE_OWNER_URL=postgres://repairdesk_owner:$POSTGRES_OWNER_PASSWORD@postgres:5432/repairdesk npx tsx scripts/migrate.ts
```

The symptom of forgetting is "the code is deployed but pages 500 with `column … does not exist`". Restart `worker`
afterwards if it booted before the migration.

Dokploy's in-browser terminal (xterm) can freeze the whole tab on long output. Run anything slow detached,
`(nohup sh -c '…' > /tmp/x.log 2>&1 &)`, then read the log, and delete the log when done.

Some features also need data after the image ships (a shop's logo, FAQ text, domains, settings). Those are the
scripts in `scripts/` (`set-logo`, `set-faqs`, `add-domain`, `shop-settings`, `reinvite`), run the same way.
`reinvite` prints an invite link: it goes to the operator's terminal, never a log or chat.

## "Nobody can sign in by phone" in production

Since D-40 the SMS and email drivers **fail closed in production**: with `SMS_DRIVER=console` or no Africa's Talking
key, sign-in codes are not sent and the screen says so. That is deliberate; a code printed to the container log would
let anyone with log access sign in as any customer. Configure Africa's Talking (platform env, or the shop's own
credentials in Admin → Settings). Delivery reports additionally need `SMS_DLR_TOKEN` in their callback URL.

## "Staff can't open the bench after signing in"

Staff rights come only from a **password** session. Someone who signed in on the customer screen with a phone code is
a customer, even if the same account is staff; `/bench` sends them to `/staff/login?error=password_required`. The
database enforces the same thing (`is_password_session()` inside the RLS helpers), so this cannot be patched in a page.

## A new domain answers 404 for a minute

`lib/tenant.ts` caches host → shop for 60 s, **misses included**. After `add-domain`, wait a minute. Local test
domains need the port (`primefix.localhost:3100`).

## The state machine lives in TypeScript and SQL

`lib/core/state-machine.ts` is the source of truth. `npm run gen:state-machine` regenerates
`db/migrations/0002_state_machine.sql`, and a unit test fails if the two differ. Production already ran 0002, so a
changed edge also needs a new numbered migration that updates `job_transitions` (see 0020, 0022). Ask the owner before
changing an edge, how money flows, or how long data is kept.

## Postgres and shell gotchas

- Postgres regex repetition bounds max out at **255**: `{10,300}` is "invalid repetition count" (0021 fixed one).
- The users update policy must never query `users` itself: Postgres rejects it as infinite recursion, and every
  profile save fails (fixed in 0023). Protect columns with column grants instead.
- Git Bash on Windows rewrites arguments that look like paths: `--landing /shop` arrives as `C:/Program Files/Git/shop`.
  Prefix the command with `MSYS_NO_PATHCONV=1`.

## React and Base UI gotchas

- A Base UI `<Button>` defaults to `type="button"`. Inside a bare `<form action>` it must say `type="submit"`, or the
  form silently never submits.
- A server component cannot pass a function to a client component (the page crashes). Pass a flag or a string key
  and resolve it on the client (`ActionForm successKind`, the icon keys in `staff-nav.tsx`).
- Private photos and ID images are rendered with `<img>`, never `next/image`: the optimiser's cache is shared.

## Local development

Docker Desktop must be running: `npm run db:up` starts Postgres (port 55432; `repairdesk` and `repairdesk_test`) and
the S3 stand-in (59000). Then `npm run db:migrate && npm run db:seed`, `npm run dev` (port 3100) and, in a second
terminal, `npm run worker`. The dev OTP is `OTP_DEV_CODE`; seeded accounts are listed at the top of `scripts/seed.ts`.
`npm run check` runs everything CI runs except the DB and browser tests (`npm test`, `npm run test:e2e`).
