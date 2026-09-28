/**
 * Point an extra domain at an existing shop, optionally opening a specific page (a retail domain → the Shop).
 * The domain still needs a DNS record to the server and a matching domain row in the reverse proxy (Dokploy).
 *
 *   npx tsx scripts/add-domain.ts --slug primefix --host primefixke.com
 *   npx tsx scripts/add-domain.ts --slug primefix --host phoneparts.co.ke --landing /shop
 */
import './shim-server-only';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const { withService } = await import('../lib/db');
  const slug = arg('slug')?.toLowerCase();
  const host = arg('host')?.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const landing = arg('landing') ?? '/';
  if (!slug || !host) {
    console.error('Usage: npx tsx scripts/add-domain.ts --slug shop --host example.co.ke [--landing / | /shop | /about]');
    process.exit(1);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/.test(host)) throw new Error(`Not a hostname: ${host}`);
  if (!['/', '/shop', '/about'].includes(landing)) throw new Error('--landing must be /, /shop or /about');
  const hosts = host.startsWith('www.') ? [host] : [host, `www.${host}`];
  await withService(async (tx) => {
    const [t] = await tx`select id from tenants where slug = ${slug}`;
    if (!t) throw new Error(`No shop with slug "${slug}".`);
    for (const h of hosts) {
      const [row] = await tx`insert into tenant_domains (hostname, tenant_id, kind, landing_path, verified_at) values (${h}, ${t.id}, 'custom', ${landing}, now())
        on conflict (hostname) do update set landing_path = excluded.landing_path where tenant_domains.tenant_id = ${t.id} returning hostname`;
      if (!row) throw new Error(`${h} already belongs to another shop.`);
    }
  });
  console.log(`${hosts.join(' and ')} → "${slug}", opening ${landing}. Add DNS A records to the server and the domains in Dokploy (service web, port 3000).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
