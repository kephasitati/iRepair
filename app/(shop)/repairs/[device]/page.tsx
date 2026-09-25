import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Bike, MessageSquareText, QrCode, ShieldCheck } from 'lucide-react';
import { DeviceIcon } from '@/components/device-icon';
import { FaqList, JsonLd } from '@/components/seo-bits';
import { DEVICE_TYPES, type DeviceType } from '@/lib/core/device-id';
import { formatKes } from '@/lib/core/money';
import { deviceFaqs } from '@/lib/faq';
import { enabledDevices, getPublishedCatalogue, DEVICE_LABEL, cityOf } from '@/lib/public-data';
import { breadcrumbJsonLd, deviceServiceJsonLd, faqJsonLd, pageMetadata } from '@/lib/seo';
import { requireTenant } from '@/lib/tenant';

type Params = { device: string };

function parseDevice(raw: string): DeviceType | null {
  return (DEVICE_TYPES as string[]).includes(raw) ? (raw as DeviceType) : null;
}

async function loadDevicePage(params: Promise<Params>) {
  const { device: raw } = await params;
  const device = parseDevice(raw);
  if (!device) notFound();
  const tenant = await requireTenant();
  if (!enabledDevices(tenant).includes(device)) notFound();
  return { tenant, device };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { tenant, device } = await loadDevicePage(params);
  const label = DEVICE_LABEL[device];
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  const city = cityOf(tenant);
  const name = tenant.branding.display_name;
  return pageMetadata(tenant, {
    title: `${label} repair in ${city} — doorstep pickup | ${name}`,
    description: `Book ${article} ${label} repair with ${name}. A rider collects it from your door in ${city}, we quote before any work, and you pay by M-Pesa.`,
    path: `/repairs/${device}`,
  });
}

/** Per-device landing page: same immersive style as the homepage, focused on one product line for SEO/AEO/GEO. */
export default async function DeviceRepairPage({ params }: { params: Promise<Params> }) {
  const { tenant, device } = await loadDevicePage(params);
  const [t, allParts] = await Promise.all([getTranslations('landing'), tenant.settings.publish_price_list ? getPublishedCatalogue(tenant.id) : Promise.resolve([])]);
  const parts = allParts.filter((p) => p.device_family === device);
  const label = DEVICE_LABEL[device];
  const article = /^[aeiou]/i.test(label) ? 'an' : 'a';
  const city = cityOf(tenant);
  const faqs = deviceFaqs(tenant, device, allParts);
  const otherDevices = enabledDevices(tenant).filter((d) => d !== device);

  const trust = [
    { icon: Bike, title: 'Collected from your door', body: `A TumaBoda rider picks up your ${label} in ${city} and brings it back after the repair.` },
    { icon: QrCode, title: 'Verified handover', body: 'Every pickup and return is confirmed with a rider QR scan and timestamped photos.' },
    { icon: MessageSquareText, title: 'Quote before any work', body: `We diagnose your ${label}, then send an itemised quote. Nothing happens until you accept it.` },
    { icon: ShieldCheck, title: 'Warranty on the fix', body: tenant.settings.warranty_days ? `${tenant.settings.warranty_days} days on parts and workmanship for the repaired fault.` : 'Workmanship you can raise a dispute on within the warranty window.' },
  ];

  return (
    <div>
      <JsonLd data={deviceServiceJsonLd(tenant, device, allParts)} />
      <JsonLd data={faqJsonLd(faqs)} />
      <JsonLd data={breadcrumbJsonLd(tenant, [{ name: 'Home', path: '/' }, { name: `${label} repair`, path: `/repairs/${device}` }])} />

      {/* Hero */}
      <section className="hero-surface">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 pt-14 pb-16 sm:pt-20 md:grid-cols-[1.1fr_1fr] md:pb-24">
          <div className="fade-up text-center md:text-left">
            <p className="text-[17px] font-semibold text-white/70">{tenant.branding.display_name}</p>
            <h1 className="display mt-2 text-[40px] sm:text-[56px] md:text-[64px]">
              <span className="text-gradient">{label} repair, at your door</span>
            </h1>
            <p className="mx-auto mt-5 max-w-md text-[19px] leading-snug text-white/75 md:mx-0">
              Pickup and return in {city}. Quoted before any work. Paid by M-Pesa.
            </p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row md:justify-start">
              <Link
                href={`/book?type=${device}`}
                className="inline-flex h-12 items-center rounded-full px-7 text-[17px] whitespace-nowrap transition-transform active:scale-[.98]"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                data-testid="repairs-book-cta"
              >
                Book {article} {label} repair
              </Link>
            </div>
          </div>
          <div className="fade-up flex justify-center [animation-delay:150ms]">
            <DeviceIcon type={device} className="h-48 w-56 text-white/90" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-5 px-4 py-14 sm:py-20">
        {/* Trust / how it works, scoped to this device */}
        <section>
          <h2 className="display text-center text-[32px] sm:text-[48px]">How {label} repair works</h2>
          <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {trust.map((x, i) => (
              <div key={i} className="tile p-5">
                <x.icon className="size-7" style={{ color: 'var(--brand-primary)' }} />
                <p className="mt-4 text-[17px] leading-tight font-semibold">{x.title}</p>
                <p className="mt-1 text-[14px] text-ink-3">{x.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Prices for this device family */}
        {parts.length ? (
          <section className="pt-6">
            <h2 className="display text-center text-[32px] sm:text-[48px]">{label} repair prices</h2>
            <p className="mt-2 text-center text-[17px] text-ink-3">{t('pricesNote')}</p>
            <div className="tile mt-8 p-6">
              <ul className="incl text-[15px]">
                {parts.map((p) => (
                  <li key={p.name}>
                    <span>{p.name}</span>
                    <span className="shrink-0 font-medium tabular-nums">{formatKes(p.default_price_cents)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <FaqList faqs={faqs} title={`${label} repair — questions and answers`} />

        <div className="tile flex flex-col items-center gap-4 px-6 py-12 text-center">
          <h2 className="display text-[28px] sm:text-[40px]">Book your {label} pickup</h2>
          <Link href={`/book?type=${device}`} className="inline-flex h-12 items-center rounded-full px-7 text-[17px]" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            Book {article} {label} repair
          </Link>
        </div>

        {otherDevices.length ? (
          <section className="pt-6 text-center">
            <p className="text-[15px] text-ink-3">We also repair</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {otherDevices.map((d) => (
                <Link key={d} href={`/repairs/${d}`} className="rounded-full bg-canvas px-4 py-2 text-[14px] hover:bg-fill">
                  {DEVICE_LABEL[d]} repair
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
