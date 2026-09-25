import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/components/seo-bits';
import { WhatsAppLink } from '@/components/whatsapp';
import { DEVICE_TYPES, type DeviceType } from '@/lib/core/device-id';
import { formatKes } from '@/lib/core/money';
import { DEVICE_LABEL, enabledDevices, getListedProduct, productImageSrc, whatsappLink } from '@/lib/public-data';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import { requireTenant } from '@/lib/tenant';

type Params = { id: string };

async function load(params: Promise<Params>) {
  const { id } = await params;
  const tenant = await requireTenant();
  if (!tenant.settings.shop_page) notFound();
  const product = await getListedProduct(tenant.id, id);
  if (!product) notFound();
  return { tenant, product };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { tenant, product } = await load(params);
  return pageMetadata(tenant, {
    title: `${product.name} — ${formatKes(product.default_price_cents)} | ${tenant.branding.display_name}`,
    description: (product.description ?? `${product.name} from ${tenant.branding.display_name}.`).slice(0, 160),
    path: `/shop/${product.id}`,
  });
}

export default async function ProductPage({ params }: { params: Promise<Params> }) {
  const { tenant, product: p } = await load(params);
  const src = productImageSrc(p);
  const family = p.device_family && (DEVICE_TYPES as string[]).includes(p.device_family) ? (p.device_family as DeviceType) : null;
  const repairable = family && family !== 'other' && enabledDevices(tenant).includes(family) && /screen|lcd|batter|port|camera|keyboard|glass|replacement/i.test(`${p.name} ${p.category ?? ''}`);
  const ask = whatsappLink(tenant, `Hi ${tenant.branding.display_name}, I'm interested in "${p.name}" (${formatKes(p.default_price_cents)}) — ${tenant.baseUrl}/shop/${p.id}`);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd(tenant, [{ name: 'Home', path: '/' }, { name: 'Shop', path: '/shop' }, { name: p.name, path: `/shop/${p.id}` }])} />
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: p.name,
          description: p.description ?? undefined,
          image: src ? (src.startsWith('http') ? src : `${tenant.baseUrl}${src}`) : undefined,
          category: p.category ?? undefined,
          offers: { '@type': 'Offer', priceCurrency: 'KES', price: (p.default_price_cents / 100).toFixed(0), availability: 'https://schema.org/InStock', url: `${tenant.baseUrl}/shop/${p.id}`, seller: { '@type': 'LocalBusiness', name: tenant.branding.display_name } },
        }}
      />
      <p className="text-[13px] text-ink-3">
        <Link href="/shop" className="hover:underline">
          Shop
        </Link>
        {p.category ? (
          <>
            {' › '}
            <Link href={`/shop?c=${encodeURIComponent(p.category)}`} className="hover:underline">
              {p.category}
            </Link>
          </>
        ) : null}
      </p>
      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div className="tile aspect-square overflow-hidden bg-canvas p-0">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={p.name} className="h-full w-full object-contain p-6" />
          ) : (
            <div className="grid h-full place-items-center text-ink-3">No photo</div>
          )}
        </div>
        <div>
          <h1 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[36px]">{p.name}</h1>
          <p className="mt-3 text-[24px] font-semibold tabular-nums">{formatKes(p.default_price_cents)}</p>
          <p className="text-[13px] text-ink-3">VAT included{family ? ` · ${DEVICE_LABEL[family]}` : ''}</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <WhatsAppLink href={ask} className="inline-flex h-12 items-center justify-center rounded-full px-7 text-[17px] text-white" style={{ background: 'var(--primary)' }}>
              Ask on WhatsApp
            </WhatsAppLink>
            {repairable ? (
              <Link href={`/book?type=${family}`} className="inline-flex h-12 items-center justify-center rounded-full bg-canvas px-7 text-[17px] hover:bg-fill">
                Book this repair
              </Link>
            ) : null}
          </div>
          {p.description ? <p className="mt-8 text-[16px] leading-relaxed whitespace-pre-line text-ink-2">{p.description}</p> : null}
          <p className="mt-8 text-[13px] text-ink-3">
            Call{' '}
            <a href={`tel:${tenant.settings.contact_phone}`} className="underline">
              {tenant.settings.contact_phone}
            </a>{' '}
            or visit {tenant.settings.address_formatted}. Payment by M-Pesa; delivery within Nairobi or by courier.
          </p>
        </div>
      </div>
    </div>
  );
}
