# White-label: running more than one shop

One deployment (one Postgres database, one running app) can serve any number of independent repair shops, each with
its own domain, branding, prices, device line-up, fee rules, and its own M-Pesa/courier/SMS credentials. A customer
or technician never sees any hint of another shop, or of the platform operator's own brand, anywhere in the shop-
facing app — the platform brand (`PLATFORM_NAME`) only ever appears at `/platform`, the operator's own console.

## How a shop resolves

Every request is routed by its `Host` header (`lib/tenant.ts`, `getTenant()`): the platform host itself (e.g.
`repairdesk.co.ke`) has no shop and serves the platform console; every other known hostname is looked up in
`tenant_domains` and resolves to exactly one shop. Look-ups are cached in-process for 60 seconds, so a branding
change shows up quickly without needing a redeploy.

## Creating a shop

Only a platform admin can create a shop (`/platform/tenants/new` → `createTenantAction`, `app/platform/actions.ts`).
This does the minimum needed to exist, nothing more — a shop's own admin configures everything else themselves:

- Row in `tenants`, a `<slug>.<PLATFORM_ROOT_DOMAIN>` subdomain (auto-verified — see the "custom domains" caveat
  below), a bare `tenant_branding` row (just the name), a bare `tenant_settings` row (just the phone number), a
  per-tenant encryption key, and an optional platform fee rule (`platform_fee_rules`: percent-of-invoice or a flat
  fee per job — the amount the shop owes the platform operator, invoiced separately, never taken from the
  customer's payment).
- One `shop_admin` membership, invited by a signed, expiring token link (`/staff/invite/<token>`) — the platform
  admin never sets or knows the shop admin's password.

## What a shop admin configures themselves (Settings)

All in `app/admin/settings/page.tsx` / `app/admin/actions.ts`, each shop independent of every other:

| Area | Fields |
| --- | --- |
| **Branding** | Display name, tagline, about text (used on the landing page, in structured data and in `/llms.txt`), primary/accent colour, logo, icon, SMS sender id, email sender name |
| **Contact** | Phone, email, address (+ lat/lng for courier quoting), opening hours per day, service zones, WhatsApp number |
| **Devices** | Which of iPhone/MacBook/iPad/iMac/Android/Windows laptop this shop repairs (`tenant_settings.device_types` — defaults to all six, DECISIONS D-20) |
| **Fees & money** | Consultation/diagnosis fee (and whether it's credited to the repair), deposit rule (percent or fixed, with a minimum-quote-value floor below which no deposit is required), VAT rate and registration, KRA PIN, warranty days, max negotiation rounds, quote expiry |
| **Operations** | Publish price list on the landing page or not, delivery provider (mock or TumaBoda), require staff 2FA or not |
| **Credentials** | Daraja (M-Pesa), TumaBoda API, Africa's Talking (SMS) — each shop's own, encrypted per-tenant (see `COMPLIANCE.md` §3) |

Colours flow into the UI as a handful of CSS variables (`lib/branding.ts`'s `brandCssVars()`) layered on top of the
shared Apple-inspired base theme (DECISIONS D-18) — a shop's brand colour becomes its primary buttons, links and
accents; the base palette, typography and layout stay consistent across every shop, so a new shop never looks
unfinished or generic even before it uploads a logo.

## Custom domains

A shop can be reached at its own subdomain (`<slug>.<platform root domain>`, created automatically) or a domain it
already owns (`example.co.ke`), added by a platform admin from the shop's page in the console
(`addTenantDomainAction`, `app/platform/actions.ts`). **Caveat:** adding a custom domain here does not itself verify
DNS ownership — it takes effect for tenant resolution immediately once added (there's no separate `verified_at`
gate on lookup, unlike the auto-verified subdomain). Only a platform admin can add one, which is the actual control
today; a self-service "verify your own domain" flow for shop admins isn't built. In production, the domain also
needs to actually be pointed at the server and added to the reverse proxy (`docs/DEPLOY.md` §4) before it will serve
anything — adding the row here doesn't provision DNS or TLS by itself, except under the Caddy on-demand TLS setup,
where the row is exactly what gates issuing a certificate for that hostname (`app/api/caddy/ask/route.ts`).

## What stays the platform's, not a shop's

- The platform database, migrations, worker process and deploy — one of each, shared by every shop; there is no
  per-shop infrastructure to provision.
- The `/platform` console itself, and the platform brand shown there.
- Cross-shop numbers on `/platform` (jobs, payments, platform fees, dead outbox jobs, webhook/SMS failures) — a
  shop admin never sees another shop's data, enforced by row-level security, not just by the UI not showing it.
- Support mode: a platform admin can act *inside* a shop for support, but only via an audited, time-boxed,
  single-use handoff (`COMPLIANCE.md` §6) — never silently, never by just having platform-admin rights.

## A new shop, start to finish

1. Platform admin: `/platform/tenants/new` — name, subdomain, shop phone, admin email, platform fee.
2. Shop admin: opens the invite link, sets a password (and 2FA, if they want it).
3. Shop admin: Settings → Branding (logo, colours, about text), Contact (address, hours, zones, WhatsApp), Devices
   (which device types this shop actually repairs), Fees, and Credentials (M-Pesa now, TumaBoda when its API
   documentation lands — `TUMABODA.md` — or leave both on their simulator/mock defaults to try the app first).
4. Optional: platform admin adds a custom domain once the shop has one, and it's pointed at the server.
