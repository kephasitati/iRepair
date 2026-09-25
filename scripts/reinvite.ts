/**
 * Re-issue the admin invite for an existing shop (the token is only stored hashed, so a lost link can't be
 * recovered — only replaced). Same 7-day expiring token `create-tenant.ts` and the platform console issue.
 *
 *   npx tsx scripts/reinvite.ts --slug primefix [--email owner@example.com]
 *
 * Without --email it targets the shop's shop_admin membership(s); with it, that one member.
 */
import './shim-server-only';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { randomToken, sha256Hex } = await import('../lib/core/crypto');
  const { withService } = await import('../lib/db');
  const { env } = await import('../lib/env');

  const slug = arg('slug')?.toLowerCase();
  const email = arg('email')?.toLowerCase();
  if (!slug) {
    console.error('Usage: npx tsx scripts/reinvite.ts --slug shop-slug [--email who@example.com]');
    process.exit(1);
  }

  const token = randomToken(24);
  const result = await withService(async (tx) => {
    const [t] = await tx`select id, name from tenants where slug = ${slug}`;
    if (!t) throw new Error(`No shop with slug "${slug}".`);
    const [d] = await tx`select hostname from tenant_domains where tenant_id = ${t.id} and is_primary`;
    const rows = email
      ? await tx`update tenant_memberships m set invite_token_hash = ${sha256Hex(token)}, invite_expires_at = now() + interval '7 days'
          from users u where u.id = m.user_id and m.tenant_id = ${t.id} and u.email = ${email} returning u.email`
      : await tx`update tenant_memberships m set invite_token_hash = ${sha256Hex(token)}, invite_expires_at = now() + interval '7 days'
          from users u where u.id = m.user_id and m.tenant_id = ${t.id} and m.role = 'shop_admin' returning u.email`;
    if (rows.length === 0) throw new Error(email ? `${email} is not a member of "${slug}".` : `"${slug}" has no shop_admin membership.`);
    return { name: t.name as string, host: d.hostname as string, emails: rows.map((r) => r.email as string) };
  });

  console.log(`\nNew invite for "${result.name}" (${result.emails.join(', ')}), valid 7 days:`);
  console.log(`${env().PUBLIC_SCHEME}://${result.host}/staff/invite/${token}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
