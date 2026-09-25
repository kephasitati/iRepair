/**
 * Onboard a new shop from the command line — the same thing `createTenantAction`
 * (`app/platform/actions.ts`) does from the platform console UI, for when that UI isn't reachable yet
 * (no DNS/no platform admin session) or you'd rather script it. Sensible defaults, nothing shop-specific
 * beyond name/slug/phone/admin email — the shop admin customises branding, prices and device types
 * themselves afterwards in Settings, exactly like any shop created through the console.
 *
 *   npx tsx scripts/create-tenant.ts --name "Primefix Kenya" --slug primefix \
 *     --phone +254700000000 --admin-email owner@example.com [--fee-percent 3]
 *
 * Prints the invite link for the shop's first admin — same 7-day expiring token the UI issues.
 */
import './shim-server-only';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function main() {
  const { randomToken, sha256Hex, generateDataKey, wrapDataKey, parseKey } = await import('../lib/core/crypto');
  const { hashPassword } = await import('../lib/core/password');
  const { normalizeKenyanPhone } = await import('../lib/core/phone');
  const { withService } = await import('../lib/db');
  const { env } = await import('../lib/env');

  const name = arg('name');
  const slug = arg('slug')?.toLowerCase();
  const phoneRaw = arg('phone');
  const adminEmail = arg('admin-email')?.toLowerCase();
  const feePercent = arg('fee-percent'); // e.g. "3" = 3%

  if (!name || !slug || !phoneRaw || !adminEmail) {
    console.error('Usage: npx tsx scripts/create-tenant.ts --name "Shop Name" --slug slug --phone +2547... --admin-email you@example.com [--fee-percent 3]');
    process.exit(1);
  }
  if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) throw new Error('Slug: lowercase letters, numbers and dashes, 3-40 characters.');
  if (['www', 'api', 'admin', 'platform', 'app', 'mail'].includes(slug)) throw new Error('That slug is reserved.');
  const phone = normalizeKenyanPhone(phoneRaw);
  if (!phone) throw new Error('Enter a valid Kenyan phone number for --phone.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new Error('Enter a valid --admin-email.');

  const host = `${slug}.${env().PLATFORM_ROOT_DOMAIN}`;
  const token = randomToken(24);

  const result = await withService(async (tx) => {
    const [exists] = await tx`select 1 from tenants where slug = ${slug}`;
    if (exists) throw new Error(`Slug "${slug}" is already taken.`);
    const [t] = await tx`insert into tenants (slug, name) values (${slug}, ${name}) returning id`;
    await tx`insert into tenant_domains (hostname, tenant_id, kind, is_primary, verified_at) values (${host}, ${t.id}, 'subdomain', true, now())`;
    await tx`insert into tenant_branding (tenant_id, display_name) values (${t.id}, ${name})`;
    await tx`insert into tenant_settings (tenant_id, contact_phone) values (${t.id}, ${phone})`;
    await tx`insert into tenant_keys (tenant_id, wrapped_data_key) values (${t.id}, ${wrapDataKey(generateDataKey(), parseKey(env().APP_MASTER_KEY), t.id)})`;
    if (feePercent) {
      await tx`insert into platform_fee_rules (tenant_id, kind, value) values (${t.id}, 'percent', ${Math.round(Number(feePercent) * 100)})`;
    }
    let [u] = await tx`select id from users where email = ${adminEmail}`;
    if (!u) [u] = await tx`insert into users (email, full_name, password_hash) values (${adminEmail}, '', ${await hashPassword(randomToken(24))}) returning id`;
    // No inviting platform admin on record yet if this is run before any exists (bootstrap) — invited_by is nullable.
    const [admin] = await tx`select id from users where is_platform_admin limit 1`;
    await tx`insert into tenant_memberships (tenant_id, user_id, role, invited_by, invite_token_hash, invite_expires_at)
      values (${t.id}, ${u.id}, 'shop_admin', ${admin?.id ?? null}, ${sha256Hex(token)}, now() + interval '7 days')`;
    return { tenantId: t.id as string, host };
  });

  console.log(`\nCreated "${name}" (slug: ${slug})`);
  console.log(`Tenant id: ${result.tenantId}`);
  console.log(`Subdomain: ${env().PUBLIC_SCHEME}://${result.host}  (needs a DNS record + it added under the platform's domain, same as the platform host itself)`);
  console.log(`Admin invite (${adminEmail}, valid 7 days): ${env().PUBLIC_SCHEME}://${result.host}/staff/invite/${token}`);
  console.log(`\nDevice types, colours, logo, fees, address/hours and credentials all default and are set by the shop admin in Settings — nothing else is pre-filled.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
