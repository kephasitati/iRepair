import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo-bits';
import { formatKes } from '@/lib/core/money';
import { DEVICE_LABEL, cityOf, getListedProducts, productImageSrc, type PublicProduct } from '@/lib/public-data';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import { requireTenant } from '@/lib/tenant';
import type { DeviceType } from '@/lib/core/device-id';

const PAGE_SIZE = 48;

type Search = { c?: string; d?: string; page?: string };

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await requireTenant();
  const name = tenant.branding.display_name;
  return pageMetadata(tenant, {
    title: `Shop — parts, devices and accessories | ${name}`,
    description: `Genuine parts, devices and accessories from ${name} in ${cityOf(tenant)}. Prices in KES, ask on WhatsApp or book a repair.`,
    path: '/shop',
  });
}

function familyLabel(f: string | null): string {
  return f && f !== 'other' && f in DEVICE_LABEL ? DEVICE_LABEL[f as DeviceType] : 'Accessories';
}

/** Browsable product catalogue: the shop's listed items with photo, price and category. */
export default async function ShopPage({ searchParams }: { searchParams: Promise<Search> }) {
  const tenant = await requireTenant();
  if (!tenant.settings.shop_page) notFound();
  const { c, d, page: pageRaw } = await searchParams;
  const all = await getListedProducts(tenant.id);

  const families = [...new Set(all.map((p) => p.device_family ?? 'other'))];
  const inFamily = d ? all.filter((p) => (p.device_family ?? 'other') === d) : all;
  const categories = [...new Set(inFamily.map((p) => p.category).filter((x): x is string => !!x))].sort();
  const filtered = c ? inFamily.filter((p) => p.category === c) : inFamily;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(pageRaw) || 1));
  const items = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const href = (q: Partial<Search>) => {
    const p = new URLSearchParams();
    const merged = { c, d, ...q };
    if (merged.d) p.set('d', merged.d);
    if (merged.c) p.set('c', merged.c);
    if (merged.page && merged.page !== '1') p.set('page', merged.page);
    const s = p.toString();
    return `/shop${s ? `?${s}` : ''}`;
  };
  const chip = (active: boolean) => `rounded-full px-4 py-1.5 text-[14px] transition-colors ${active ? 'text-white' : 'bg-canvas hover:bg-fill'}`;
  const chipStyle = (active: boolean) => (active ? { background: 'var(--primary)' } : undefined);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd(tenant, [{ name: 'Home', path: '/' }, { name: 'Shop', path: '/shop' }])} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: `${tenant.branding.display_name} shop`,
          numberOfItems: filtered.length,
          itemListElement: items.map((p, i) => ({ '@type': 'ListItem', position: (page - 1) * PAGE_SIZE + i + 1, url: `${tenant.baseUrl}/shop/${p.id}`, name: p.name })),
        }}
      />
      <h1 className="display text-center text-[36px] sm:text-[56px]">Shop</h1>
      <p className="mt-2 text-center text-[17px] text-ink-3">Parts, devices and accessories. Prices in KES, VAT included. Ask on WhatsApp to order.</p>

      {families.length > 1 ? (
        <div className="no-scrollbar mt-8 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:justify-center">
          <Link href={href({ d: undefined, c: undefined, page: '1' })} className={chip(!d)} style={chipStyle(!d)}>
            All
          </Link>
          {families.map((f) => (
            <Link key={f} href={href({ d: f, c: undefined, page: '1' })} className={chip(d === f)} style={chipStyle(d === f)}>
              {familyLabel(f)}
            </Link>
          ))}
        </div>
      ) : null}
      {categories.length > 1 ? (
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1 text-ink-2 sm:flex-wrap sm:justify-center">
          {categories.map((cat) => (
            <Link key={cat} href={href({ c: c === cat ? undefined : cat, page: '1' })} className={`${chip(c === cat)} text-[13px]`} style={chipStyle(c === cat)}>
              {cat}
            </Link>
          ))}
        </div>
      ) : null}

      {items.length ? (
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {items.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-12 text-center text-ink-3">Nothing listed here yet.</p>
      )}

      {pages > 1 ? (
        <nav className="mt-10 flex items-center justify-center gap-3 text-[15px]" aria-label="Pages">
          {page > 1 ? (
            <Link href={href({ page: String(page - 1) })} className="rounded-full bg-canvas px-4 py-2 hover:bg-fill">
              ← Previous
            </Link>
          ) : null}
          <span className="text-ink-3">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={href({ page: String(page + 1) })} className="rounded-full bg-canvas px-4 py-2 hover:bg-fill">
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

function ProductCard({ product: p }: { product: PublicProduct }) {
  const src = productImageSrc(p);
  return (
    <Link href={`/shop/${p.id}`} className="tile group flex h-full flex-col overflow-hidden p-0 transition-transform hover:-translate-y-0.5">
      <div className="aspect-square w-full bg-canvas">
        {src ? (
          // Product photos come from the shop's own storage or its previous website; not a Next-optimised source.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={p.name} loading="lazy" className="h-full w-full object-contain p-3" />
        ) : (
          <div className="grid h-full place-items-center text-[13px] text-ink-3">No photo</div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <p className="line-clamp-2 text-[14px] leading-snug font-medium sm:text-[15px]">{p.name}</p>
        <p className="mt-auto pt-2 text-[15px] font-semibold tabular-nums">{formatKes(p.default_price_cents)}</p>
      </div>
    </Link>
  );
}
