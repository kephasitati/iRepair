import { servicePool } from '@/lib/db';

/**
 * Caddy on-demand TLS gate: Caddy asks before issuing a certificate for a hostname.
 * 200 only for hostnames registered in tenant_domains, so nobody can make us request certs for arbitrary names.
 */
export async function GET(req: Request) {
  const domain = new URL(req.url).searchParams.get('domain')?.toLowerCase();
  if (!domain) return new Response('missing', { status: 400 });
  const [row] = await servicePool()`select 1 from tenant_domains d join tenants t on t.id = d.tenant_id where d.hostname = ${domain} and t.status = 'active'`;
  return new Response(row ? 'ok' : 'unknown', { status: row ? 200 : 404 });
}
