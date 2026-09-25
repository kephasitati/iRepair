# TumaBoda courier integration

Every device is collected from and returned to the customer by a TumaBoda rider. The app is built against a small,
vendor-neutral `DeliveryProvider` interface (`lib/providers/delivery/types.ts`) so TumaBoda is a plug-in, not
scattered through the codebase — `MockProvider` (used everywhere in dev and tests) and `TumaBodaProvider`
(`lib/providers/delivery/tumaboda.ts`) both implement the exact same eight methods.

## Status: waiting on TumaBoda's API documentation

**`TumaBodaProvider` is a structurally-complete skeleton, not a working integration.** Every endpoint path, request
field, response field and status string in it is a `TODO(TUMABODA)`-marked placeholder, because no API
documentation was available while building this. What's real and won't change once the real docs arrive:

- The **shape** of every method (what it takes, what it returns) — this matches `DeliveryProvider` exactly, which
  the rest of the app (booking, the bench board, handover scanning, the courier webhook) is already built against.
- The **webhook signature and replay protection** — HMAC-SHA256 over `"<timestamp>.<raw body>"`, compared with
  `safeEqual()` (constant-time), with the timestamp rejected if it's more than 5 minutes old. This is a reasonable
  default for "some vendor's webhook", not TumaBoda-specific, and can stay even if the real header names or hashing
  details differ (only `parseWebhook()`'s first few lines would change).
- The **event id → dedupe** flow: `app/api/webhooks/delivery/[tenant]/route.ts` inserts the raw webhook first, then
  the provider's own `eventId` (whatever TumaBoda calls it) becomes a unique `dedupe_key`, so a retried webhook is
  a safe no-op rather than a double-processed delivery update.

**What a TumaBoda integration engineer needs to hand over, to turn the `TODO`s into real code:**

1. Auth scheme for the merchant API (API key header? OAuth? — currently assumed `Authorization: Bearer <apiKey>`).
2. Endpoints and field names for: quote, create delivery, cancel, get status, verify rider QR, verify handover OTP.
3. The status vocabulary TumaBoda actually sends (`STATUS_MAP` in `tumaboda.ts` needs real keys on the left).
4. Webhook: header names for signature and timestamp, the exact string that's signed, the hash algorithm, and the
   field name TumaBoda uses for its own event id (for dedupe).
5. Whether "verify rider QR" and "verify handover OTP" are separate calls or the same one — the app calls whichever
   `input.method` the customer/technician used (`recordHandover`, `lib/jobs/logistics.ts`).

Until then, every shop should run with `tenant_settings.delivery_provider = 'mock'` (the default) — `MockProvider`
(`lib/providers/delivery/mock.ts`) is a fully working, self-contained simulator, not a stub: it's what every test in
this repo runs against.

## How `MockProvider` behaves, and why it's safe to demo with

- **Stateless.** A delivery id encodes its own creation timestamp; a rider's QR code and handover OTP are HMACs of
  that id with a server secret (`MOCK_PROVIDER_SECRET`). So delivery status is a pure function of elapsed time
  (`MOCK_DELAY_SECONDS` between each stage) — it works identically across Node processes, container restarts, and
  in tests, with no in-memory or database state of its own to get out of sync.
- Verifying a QR or OTP recomputes the same HMAC and compares it — so a customer's booking wizard, the technician
  bench, and `tests/e2e/support.ts`'s `mock` helper are all exercising the exact same verification code a real
  provider adapter would need to satisfy.
- `worker/tasks.ts`'s `pollDeliveries` calls `provider.status()` on any delivery still in flight — `MockProvider`
  advances through `requested → rider_assigned → rider_en_route → picked_up → in_transit → delivered` based on
  elapsed time, which is what makes the demo/e2e flow move forward without a person clicking anything.

## Handover verification (both legs, both directions)

A pickup or return is only recorded once someone scans (QR) or types (OTP) the rider's code — never on trust:

| Point | Who scans | Method |
| --- | --- | --- |
| `customer_to_rider` | Customer, at their door | QR (camera) or OTP |
| `rider_to_shop` | Technician, at the counter | QR or OTP |
| `shop_to_rider` | Technician, handing off the repaired device | QR or OTP |
| `rider_to_customer` | Customer, on delivery | QR or OTP |

Every attempt — successful or not — is recorded in `handover_events` with geo (if the browser granted location),
a timestamp, and (for the pickup leg) the photo ids taken just before. A failed attempt is written in its own
service-role transaction specifically so it survives even if the customer's own transaction later rolls back
(DECISIONS D-22's sibling bug that was fixed alongside the other three this session: failed scans used to be lost).

## Per-shop configuration

Each shop enters its own TumaBoda API base URL, API key and webhook secret in **Settings → Credentials**
(`app/admin/actions.ts`, encrypted the same way M-Pesa credentials are — see `MPESA.md`). The webhook URL to give
TumaBoda for a shop is shown right there: `{tenant.baseUrl}/api/webhooks/delivery/{tenant.slug}`.
