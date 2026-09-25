# Compliance and data protection

This describes what the app actually does, not aspirational policy — every claim below points at the code that
enforces it. Written with Kenya's Data Protection Act, 2019 in mind (the primary market), but the practices here
(minimise collection, encrypt what's sensitive, log who touched what, delete on a schedule) aren't Kenya-specific.

## 1. What personal data is collected, and why

| Data | Why | Where |
| --- | --- | --- |
| Customer name, phone, email (optional) | Identify the customer, send OTPs and notifications | `users` |
| Pickup/return address, geo coordinates | Tell the courier where to go | `addresses`, `jobs.pickup_address` |
| Device IMEI or serial | Prove which physical device a job is about; catch a mismatch at intake | `job_secrets.identifier` (plaintext — not sensitive like a passcode, but only shown to staff who can already see the job) |
| **Device passcode**, if the customer chooses to share it | Let the technician unlock the device to diagnose/repair it | `job_secrets.passcode_enc` — **encrypted, see §3**; never required, never logged |
| Photos of the device | Evidence of condition at each handover, and of the fault | Private object storage (`job_photos`), signed URLs only — see §2 |
| Payment records | M-Pesa receipts, amounts, timestamps — accounting and dispute evidence | `payments`, `invoices` |
| IP address, user agent | Cookie consent record and staff audit log only, not tracked elsewhere | `cookie_consents`, `audit_log` |

## 2. Photos: private storage, signed URLs, no public bucket

Every photo lives in a private S3-compatible bucket (SeaweedFS locally, R2/S3 in production) and is served only
through a short-lived signed URL generated per-request after an RLS check that the viewer may see that job — never
a public bucket path. See `lib/storage.ts` and `app/api/photos/route.ts`.

## 3. Encryption

- **Device passcodes** are encrypted with AES-256-GCM using a per-tenant data key, itself wrapped by `APP_MASTER_KEY`
  (envelope encryption, `lib/core/crypto.ts`, `lib/tenant-crypto.ts`). The wrapped per-tenant key lives in
  `tenant_keys`, a table with row-level security enabled and **no policy for the ordinary app role** — by design, a
  system secret is never tenant-role-readable, only the service role (`repairdesk_service`, `BYPASSRLS`) can reach
  it, regardless of which transaction asks (fixed this session after exactly this design being violated
  accidentally — see DECISIONS D-22).
- A passcode is **never logged**, **never included in any SMS/email/WhatsApp notification**, and is only decrypted
  to display to the technician actually assigned to that job, each reveal recorded in `audit_log`
  (`revealPasscode()`, `lib/jobs/service.ts`).
- A passcode is **purged** (`passcode_enc`, `passcode_key_version` set to `null`, `purged_at` stamped) the moment a
  job reaches a terminal state — `transition_job()`'s terminal housekeeping, `db/migrations/0005_functions.sql`. It
  does not linger in the database after the job is done, closed, cancelled or returned undeclined.
- Staff passwords use scrypt (`lib/core/password.ts`); session tokens are random, stored hashed, and bound to the
  host that issued them.

## 4. Retention

- **Photos**: deleted `retention_days` (`tenant_settings`, default from the brief's "90 days") after a job closes —
  the object is deleted from storage and the row marked `deleted_at`, not just hidden (`retentionSweep()`,
  `worker/tasks.ts`). This is intentionally the only thing on a schedule to auto-delete.
- **Invoices, payments, events, the audit log** are kept indefinitely by default (DECISIONS Q-22) — these are
  financial and accountability records, not deleted on a timer. A shop that needs a shorter retention for these for
  its own legal reasons would need that as an explicit, separate decision (not implemented — ask before assuming).
- **Cookie consent records** (`cookie_consents`) are kept as the proof of consent itself; the IP address stored
  alongside is hashed (`ip_hash`), not stored in the clear.

## 5. Audit log

Every staff action that changes a job or a shop's settings writes one row to `audit_log` — actor, tenant, action
name, entity, a diff of what changed, IP and user agent — inside the **same transaction** as the change itself
(`audit()`, `lib/audit.ts`), so an audit row can never exist without its change having actually committed, or vice
versa. Platform-admin support-mode actions record `impersonated_by` so an impersonated action is traceable to the
real platform admin who did it, not just "the shop admin."

## 6. Access control

- **Row-level security on every table** (`db/migrations/0004_rls.sql`): the ordinary app role
  (`repairdesk_app`) can only see rows for the tenant and user identity set on its own transaction
  (`set_config('app.tenant_id'/'app.user_id', ...)`), enforced by Postgres itself, not just application code.
- **Support mode** (a platform admin acting inside a shop, for support) is a single-use, 60-second handoff token
  that starts a separate, time-boxed (60-minute) session — it is never silent, never long-lived, and is itself an
  audited action.
- **Two-factor authentication** is mandatory for platform admins and optional (shop-configurable) for shop admins
  (`tenant_settings.require_admin_mfa`) — TOTP, RFC 6238 (`lib/core/totp.ts`).

## 7. Third parties data is shared with

- **Safaricom Daraja** (M-Pesa): phone number and amount, to request a payment prompt. See `MPESA.md`.
- **The courier** (TumaBoda, or the mock provider in dev): pickup/return address, phone numbers, item value
  declared for insurance purposes. See `TUMABODA.md`. No device passcode or photos are ever sent to the courier.
- **Africa's Talking** (SMS) and the shop's own SMTP (email): phone number/email address and the notification text
  only — never a passcode (see §3).
- Each shop's own third-party credentials (Daraja, TumaBoda, Africa's Talking) are entered per-shop and encrypted
  the same way as a passcode (`app/admin/actions.ts`) — the platform operator's own credentials are never used to
  move a shop's money or a shop's customer's data.

## 8. Consent

- **Terms of Service** acceptance is recorded per job (`jobs.terms_version`, `terms_accepted_at`), enforced by a
  database trigger (`db/migrations/0010_consent_and_terms.sql`) — a job cannot be submitted without it, not just a
  checkbox the UI happens to show.
- **Cookie consent** (essential-only vs. essential+analytics+marketing) is asked on first visit and recorded per
  visitor (`cookie_consents`), re-asked whenever `COOKIE_POLICY_VERSION` (`lib/legal.ts`) changes materially. Only
  three cookies are ever set, all "strictly necessary" (session, the consent choice itself, and a visitor id that
  links a browser to its own consent record) — see the table in `lib/legal.ts` and the customer-facing `/privacy`
  page's cookie section.

## 9. Trademark

The current brand name ("iRepair") and mark (a screwdriver-bit icon standing beside/replacing a letterform "i") sit
close to Apple Inc.'s naming and product conventions. **Before any real-world use**, run a trademark search with
KIPI (Kenya Industrial Property Institute) and get legal sign-off — this has not been done, and this codebase
should not be taken as clearance to use the name commercially as-is. See DECISIONS D-19.

## 10. What this document doesn't cover

This is an engineering summary of controls actually implemented, not a substitute for a lawyer's Data Protection
Impact Assessment, a registration with the Office of the Data Protection Commissioner (required for most data
controllers/processors in Kenya), or a real incident-response plan. Get those before going live with real customer
data.
