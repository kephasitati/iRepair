/**
 * Set a shop's logo (and optionally its icon) from a URL or a local file — the same thing Settings → Branding does,
 * for shops whose admin hasn't signed in yet. Needs the S3_* variables to point at real storage.
 *
 *   npx tsx scripts/set-logo.ts --slug primefix --logo https://example.com/logo.png [--icon https://example.com/icon.png]
 *   npx tsx scripts/set-logo.ts --slug primefix --logo ./logo.svg
 */
import './shim-server-only';
import { readFileSync } from 'node:fs';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };
const BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' };

async function load(source: string): Promise<{ body: Buffer; type: string; ext: string }> {
  if (/^https?:\/\//.test(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`${source}: HTTP ${res.status}`);
    const type = res.headers.get('content-type')?.split(';')[0].trim() ?? '';
    const ext = TYPES[type];
    if (!ext) throw new Error(`${source}: unsupported image type "${type}" (use PNG, JPG, WebP or SVG).`);
    return { body: Buffer.from(await res.arrayBuffer()), type, ext };
  }
  const ext = source.split('.').pop()?.toLowerCase() ?? '';
  const type = BY_EXT[ext];
  if (!type) throw new Error(`${source}: use a .png, .jpg, .webp or .svg file.`);
  return { body: readFileSync(source), type, ext: ext === 'jpeg' ? 'jpg' : ext };
}

async function main() {
  const { withService } = await import('../lib/db');
  const { brandingKey, putObject } = await import('../lib/storage');
  const slug = arg('slug')?.toLowerCase();
  const logo = arg('logo');
  const icon = arg('icon');
  if (!slug || (!logo && !icon)) {
    console.error('Usage: npx tsx scripts/set-logo.ts --slug shop-slug --logo <url|file> [--icon <url|file>]');
    process.exit(1);
  }

  const patch: Record<string, string> = {};
  const tenantId = await withService(async (tx) => {
    const [t] = await tx`select id from tenants where slug = ${slug}`;
    if (!t) throw new Error(`No shop with slug "${slug}".`);
    return t.id as string;
  });
  for (const [field, source] of [['logo', logo], ['icon', icon]] as const) {
    if (!source) continue;
    const { body, type, ext } = await load(source);
    if (body.length > 1024 * 1024) throw new Error(`${field}: images must be under 1 MB (this one is ${Math.round(body.length / 1024)} KB).`);
    const key = brandingKey(tenantId, `${field}-${Date.now()}`, ext);
    await putObject(key, body, type);
    patch[`${field}_path`] = key;
    console.log(`${field}: stored ${Math.round(body.length / 1024)} KB as ${key}`);
  }
  await withService((tx) => tx`update tenant_branding set ${tx(patch)} where tenant_id = ${tenantId}`);
  console.log(`Updated "${slug}". The header, invoices and Open Graph image use it from the next request (the tenant cache refreshes within 60 s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
