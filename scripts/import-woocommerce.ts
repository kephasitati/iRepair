/**
 * Import a WooCommerce shop's public product catalogue into a tenant's parts catalogue, via the store's
 * unauthenticated Store API (`/wp-json/wc/store/v1/products`). Re-runnable: products are keyed by SKU `WC-<id>`,
 * so a second run updates names/prices instead of duplicating rows, and products that disappeared from the
 * shop are deactivated (never deleted — quotes may reference them).
 *
 *   npx tsx scripts/import-woocommerce.ts --slug primefix --site https://primefixke.com [--dry-run]
 *
 * Repair parts (screens, batteries, ports, cameras, keyboards) are marked `published` so they show on
 * the public price list once the shop admin turns that list on in Settings; retail devices and accessories are
 * imported quote-only. Device family is inferred from the product's categories and name.
 */
import './shim-server-only';

type WcProduct = {
  id: number;
  name: string;
  sku?: string;
  categories: { name: string }[];
  prices: { price: string; currency_minor_unit: number; currency_code: string };
  is_in_stock?: boolean;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&#8243;': '"', '&#8217;': '’', '&#8211;': '–', '&quot;': '"', '&#039;': "'", '&nbsp;': ' ' };
function clean(s: string): string {
  return s.replace(/&[#\w]+;/g, (m) => ENTITIES[m] ?? m).replace(/\s+/g, ' ').trim();
}

const REPAIR_CATEGORY = /screen|lcd|batter|charging port|camera|keyboard/i;

export function deviceFamily(name: string, categories: string[]): string {
  const h = `${name} ${categories.join(' ')}`.toLowerCase();
  if (/\bipad\b|apple pencil/.test(h)) return 'ipad';
  if (/\bimac\b/.test(h)) return 'imac';
  if (/macbook|magsafe|magic keyboard|magic mouse/.test(h)) return 'macbook';
  if (/apple watch|watch series|watch ultra|watch se\b|\bwatch\b/.test(h)) return 'apple_watch';
  if (/airpod|earpod|powerbank|power bank|protector/.test(h)) return 'other';
  if (/samsung|galaxy|oneplus|one plus|\bfold\b|\bflip\b|note ?\d|pixel|xiaomi|redmi|tecno|infinix|oppo|huawei|\bs2\d\b|\ba\d{2}\b/.test(h)) return 'android';
  if (/iphone|lightning|\bx-?1\d\b|\bxs\b|\bxr\b/.test(h)) return 'iphone';
  return 'other';
}

async function fetchAll(site: string): Promise<WcProduct[]> {
  const all: WcProduct[] = [];
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${site}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`${site} returned HTTP ${res.status} on page ${page}`);
    const batch = (await res.json()) as WcProduct[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function main() {
  const { withService } = await import('../lib/db');
  const slug = arg('slug')?.toLowerCase();
  const site = arg('site')?.replace(/\/+$/, '');
  const dryRun = process.argv.includes('--dry-run');
  if (!slug || !site || !/^https?:\/\//.test(site)) {
    console.error('Usage: npx tsx scripts/import-woocommerce.ts --slug shop-slug --site https://shop.example.com [--dry-run]');
    process.exit(1);
  }

  const products = await fetchAll(site);
  const rows = products
    .filter((p) => p.prices?.price && p.prices.currency_code === 'KES')
    .map((p) => {
      const categories = p.categories.map((c) => clean(c.name));
      const name = clean(p.name);
      const minor = p.prices.currency_minor_unit ?? 0;
      const cents = Math.round(Number(p.prices.price) * 10 ** (2 - minor));
      return { sku: `WC-${p.id}`, name, device_family: deviceFamily(name, categories), published: categories.some((c) => REPAIR_CATEGORY.test(c)), cents };
    })
    .filter((r) => r.cents > 0);

  const byFamily: Record<string, number> = {};
  for (const r of rows) byFamily[r.device_family] = (byFamily[r.device_family] ?? 0) + 1;
  console.log(`${site}: ${products.length} products, ${rows.length} importable (KES, priced), ${rows.filter((r) => r.published).length} repair parts to publish`);
  console.log('By device family:', byFamily);
  if (dryRun) {
    for (const r of rows.slice(0, 15)) console.log(`  ${r.sku}  ${r.device_family.padEnd(8)} ${r.published ? 'public ' : 'quote  '} KES ${r.cents / 100}  ${r.name}`);
    process.exit(0);
  }

  const result = await withService(async (tx) => {
    const [t] = await tx`select id from tenants where slug = ${slug}`;
    if (!t) throw new Error(`No shop with slug "${slug}".`);
    const existing = new Set((await tx`select sku from parts_catalogue where tenant_id = ${t.id} and sku like 'WC-%'`).map((r) => r.sku as string));
    let inserted = 0, updated = 0;
    for (const r of rows) {
      if (existing.has(r.sku)) {
        await tx`update parts_catalogue set name = ${r.name}, device_family = ${r.device_family}, default_price_cents = ${r.cents}, active = true where tenant_id = ${t.id} and sku = ${r.sku}`;
        updated++;
      } else {
        await tx`insert into parts_catalogue (tenant_id, sku, name, device_family, kind, default_price_cents, published)
          values (${t.id}, ${r.sku}, ${r.name}, ${r.device_family}, 'part', ${r.cents}, ${r.published})`;
        inserted++;
      }
    }
    const current = rows.map((r) => r.sku);
    const gone = await tx`update parts_catalogue set active = false where tenant_id = ${t.id} and sku like 'WC-%' and active and not (sku = any(${current})) returning sku`;
    return { inserted, updated, deactivated: gone.length };
  });
  console.log(`Done: ${result.inserted} inserted, ${result.updated} updated, ${result.deactivated} deactivated (no longer on the site).`);
  console.log('Note: existing rows keep their "published" flag — that is the shop admin\'s to curate in Admin → Parts.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
