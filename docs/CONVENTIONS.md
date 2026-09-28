# Code conventions

How code is written here. The rules follow the conventions of the TumaBoda / Urban Market
codebase (`Levi-Opunga/ecommerce-astro`) so the two read alike, and keep the places where
this codebase is already stricter: zod at every boundary, `strict` TypeScript, and Postgres
row-level security under everything.

`npm run check` enforces what a machine can (types, lint, formatting, unit tests). The rest is
review.

## Where code goes

| Path | What lives there |
|---|---|
| `app/**/page.tsx` | Rendering only. Load through `lib/`, never write. |
| `app/**/actions.ts` | Server actions. Authenticate, validate, call `lib/`, return an `ActionResult`. |
| `app/**/route.ts` | HTTP handlers (webhooks, uploads, exports). Same shape as actions. |
| `lib/core/` | Pure logic: state machine, money, fees, time, crypto primitives. No I/O, no `server-only`, fully unit-tested. |
| `lib/jobs/`, `lib/*.ts` | Services: database and provider calls, always inside `withUser` / `withService`. |
| `lib/providers/` | Seams to the outside world (M-Pesa, TumaBoda, SMS, email). A real driver and a local one each. |
| `worker/` | The outbox and timers. Everything it does must be safe to retry. |
| `scripts/` | Operator tools run inside the container. Idempotent. |
| `db/migrations/` | Forward-only SQL. Never edit one that has run in production; add the next number. |

A route or action is thin: guard, validate, call one service, answer. Logic that decides
something (may this actor do this, what does this cost, what happens next) is a pure function
in `lib/core/` with its own test, so the decision can be read and tested apart from the I/O.

## Naming

- Files are kebab-case: `customer-ids.ts`, `staff-stepper.tsx`.
- Functions start with a verb: `createOrUpdateDraft`, `requireStaff`, `settleZeroReturnFee`.
  Derivations read as nouns: `consultationFeeFor(type)`, `stageIndex(status)`, `nextStep(status)`.
- Booleans read as a state or a question: `isSimulatedMpesa`, `isGuardError`, `canTransition`.
- Constants are `SCREAMING_SNAKE`, with the unit in the name and numeric separators:
  `MAX_BYTES = 8 * 1024 * 1024`, `OTP_TTL_MIN = 10`. Money is always `*_cents` (integer KES cents).
- Database and wire fields stay `snake_case`; locals are `camelCase`.
- A closed set is an `as const` tuple, and its type is derived from it, never written twice.

## Functions

- Guard first, one check per line, and return (or throw) early. The happy path runs down the
  left margin.
- A service that can fail for an expected reason returns
  `{ ok: true, … } | { ok: false, reason }`. Throw only for the unexpected, and throw
  `UserError` only for a message the person on the other end should read.
- Export `function` declarations. Small private helpers may be `const` arrows.
- No `any`. Take `unknown` and narrow it, or parse it with zod.

## Validating input

Everything that crosses a trust boundary is parsed before it is used: form data, JSON bodies,
search params, cookies, webhook payloads, environment variables, provider responses you
branch on. Parse with zod (`safeParse`, then a guard), clamp numbers, allowlist enums, and
check ids are UUIDs before they reach a query. Never `JSON.parse(x) as T`.

## Security rules

These are not up for discussion in review.

1. **The tenant comes from the host, the actor from the session.** Never take a tenant id,
   user id or role from the request. Every query runs through `withUser(ctx, …)` so row-level
   security applies. `withService` (which bypasses RLS) is for the worker, webhooks and
   checked system steps, and it filters by `tenant_id` explicitly every time.
2. **Every action states who may call it** in its first line: `requireStaff('shop_admin')`,
   `requireCustomer()`. No guard, no merge.
3. **State and money move only through the database functions** (`transition_job`,
   `confirm_payment`). The allowed edges live in `lib/core/state-machine.ts` and are generated
   into SQL. Never `update jobs set status`.
4. **Secrets are never logged, stored or sent in the clear.** That covers OTPs, invite and
   callback tokens, passwords, device passcodes, ID numbers, API keys and full phone numbers
   (log the last 3 digits). Single-use codes are stored as hashes, burned before any side
   effect, compared with `timingSafeEqual`, and attempt-limited.
5. **Webhooks verify before they act**, record every delivery in `webhook_events`, dedupe on a
   unique key and answer 2xx to a duplicate.
6. **Never echo an unknown error to a client.** Log it with a `[tag]` prefix and answer with a
   fixed message. Error text reaches the user only from `UserError`, a guard in the database
   (`GUARD:`), or a mapped provider reason.
7. **Photos and ID documents are private.** They are served only through a checked route that
   answers with a short-lived signed URL, and are shown with `<img>`, never `next/image`
   (its cache is shared across users).
8. **Every privileged write is audited** (`audit()`), with ids and outcomes, never the
   secret itself.
9. **Ask before changing** how money flows, which state transitions exist, or how long data is
   kept. Record the decision in `docs/DECISIONS.md`.

## Errors and logging

- Server actions go through `run()` in `lib/actions.ts`, which turns a `UserError` into
  `{ ok: false, error }`, logs anything else and answers with a generic message.
- Route handlers answer `Response.json({ error: 'snake_case_code' }, { status })`, with codes
  such as `unauthorized`, `not_found`, `bad_request`, `too_large`.
- Logs are one line with a tag: `console.warn('[mpesa] callback rejected: bad token')`.

## Comments and docs

- Comment the why, not the what: the constraint, the incident, the alternative that was
  rejected. An exported function gets a one-line docblock if its name doesn't say everything.
- Decisions that shape behaviour go in `docs/DECISIONS.md` (D-numbered).
- Hard-won operational knowledge (symptom → cause → fix) goes in `AGENTS.md`.

## Formatting

Prettier decides (`.prettierrc.json`): double quotes, semicolons, trailing commas, 160 columns (one long SQL
statement or line of copy reads better than a stack of fragments). Markdown is written by hand. The commit that
first formatted the tree is listed in `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs`
once so `git blame` skips it.
`npm run format` rewrites; `npm run format:check` is part of `npm run check` and CI. Lint must
be clean; an `eslint-disable` carries a `--` reason.

## Tests

- `tests/unit` covers pure logic in `lib/core`: every edge of the state machine, fees, money, identity.
- `tests/db` runs against Postgres and proves the guards and RLS policies.
- `tests/e2e` walks the booking-to-delivery path in a browser.
- Name tests as sentences that state the rule: `it('a courier is only booked after an admin releases the device')`.
- A bug fix comes with the test that would have caught it.

## Scripts

Scripts in `scripts/` run inside the production container. They are idempotent (running one
twice changes nothing the second time), print what they changed, and take `--dry-run` wherever
they write more than one row. They never print a secret; an invite link goes to the operator's
terminal only, never a log.

## Commits

One unit of work per commit. The subject is a plain sentence about the outcome, under ~72
characters, with an optional area prefix (`Bench:`, `Admin:`, `Fix:`). The body, when needed,
is prose: the problem, what changed and why, how it was verified, and any deploy step
(migration, script, env var) that must follow the push.
