import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Bike, Camera, ClipboardCheck, MessageSquareText, QrCode, ShieldCheck, Smartphone, Wallet } from 'lucide-react';
import { PhoneMock } from '@/components/phone-mock';
import { DeviceIcon } from '@/components/device-icon';
import { FaqList, JsonLd } from '@/components/seo-bits';
import { DEFAULT_DEVICE_TYPES } from '@/lib/core/device-id';
import { generalFaqs } from '@/lib/faq';
import { getPublishedCatalogue, getRatingSummary } from '@/lib/public-data';
import { faqJsonLd, localBusinessJsonLd, pageMetadata } from '@/lib/seo';
import { requireTenant } from '@/lib/tenant';
import { formatKenyanPhone } from '@/lib/core/phone';
import { formatKes } from '@/lib/core/money';
import { WEEKDAYS } from '@/lib/core/time';
import { getSession } from '@/lib/auth';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await requireTenant();
  const name = tenant.branding.display_name;
  const description =
    tenant.branding.about ??
    `${name} collects your iPhone, MacBook, iPad or iMac from your door in Nairobi, repairs it, and returns it. Pay by M-Pesa. Track every step live.`;
  return pageMetadata(tenant, { title: `${name} — Device repair, picked up and returned`, description, path: '/', absoluteTitle: true });
}

/** Apple product-page style landing: dark immersive hero, generous tiles, one primary action. */
export default async function Landing() {
  const [tenant, session, t] = await Promise.all([requireTenant(), getSession(), getTranslations()]);
  const [parts, rating] = await Promise.all([
    tenant.settings.publish_price_list ? getPublishedCatalogue(tenant.id) : Promise.resolve([]),
    getRatingSummary(tenant.id),
  ]);
  const families = [...new Set(parts.map((p) => p.device_family ?? 'other'))];
  const deviceTypes = tenant.settings.device_types?.length ? tenant.settings.device_types : DEFAULT_DEVICE_TYPES;
  const faqs = generalFaqs(tenant, parts);
  const steps = [
    { icon: ClipboardCheck, title: t('landing.step1'), body: t('landing.step1d') },
    { icon: Bike, title: t('landing.step2'), body: t('landing.step2d') },
    { icon: MessageSquareText, title: t('landing.step3'), body: t('landing.step3d') },
    { icon: Wallet, title: t('landing.step4'), body: t('landing.step4d') },
  ];
  const trust = [
    { icon: QrCode, title: t('landing.trust1'), body: t('landing.trust1d') },
    { icon: Camera, title: t('landing.trust2'), body: t('landing.trust2d') },
    { icon: ShieldCheck, title: t('landing.trust3'), body: t('landing.trust3d') },
    { icon: Smartphone, title: t('landing.trust4'), body: t('landing.trust4d') },
  ];

  return (
    <div>
      <JsonLd data={localBusinessJsonLd(tenant, parts, rating)} />
      <JsonLd data={faqJsonLd(faqs)} />
      {/* Hero */}
      <section className="hero-surface">
        <div className="mx-auto grid max-w-5xl items-center gap-10 px-5 pt-14 pb-16 sm:pt-20 md:grid-cols-[1.1fr_1fr] md:pb-24">
          <div className="fade-up text-center md:text-left">
            <p className="text-[17px] font-semibold text-white/70">{tenant.branding.display_name}</p>
            <h1 className="display mt-2 text-[44px] sm:text-[64px] md:text-[72px]">
              <span className="text-gradient">{t('landing.heroTitle')}</span>
            </h1>
            <p className="mx-auto mt-5 max-w-md text-[19px] leading-snug text-white/75 md:mx-0">{tenant.branding.tagline ?? t('landing.heroSub')}</p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row md:justify-start">
              <Link
                href="/book"
                className="inline-flex h-12 items-center rounded-full px-7 text-[17px] whitespace-nowrap transition-transform active:scale-[.98]"
                style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
                data-testid="book-cta"
              >
                {t('landing.cta')}
              </Link>
              <a href="#how" className="text-[17px] whitespace-nowrap text-[#2997ff] hover:underline">
                {t('landing.learnHow')} ›
              </a>
            </div>
            {session ? (
              <Link href="/jobs" className="mt-4 inline-block text-[15px] text-white/60 hover:text-white">
                {t('landing.myJobs')} ›
              </Link>
            ) : null}
          </div>
          <div className="fade-up [animation-delay:150ms]">
            <PhoneMock shop={tenant.branding.display_name} />
          </div>
        </div>
      </section>

      {/* Product row, as in apple.com's chapter navigation */}
      <nav aria-label={t('landing.weRepair')} className="border-b border-line bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-8 pb-6">
          <p className="text-center text-[15px] font-semibold text-ink-3">{t('landing.weRepair')}</p>
          <ul className="no-scrollbar mt-5 flex justify-center gap-2 overflow-x-auto sm:gap-8">
            {deviceTypes.map((d) => (
              <li key={d}>
                <Link href={`/repairs/${d}`} className="group flex w-20 flex-col items-center gap-2 rounded-2xl px-1 py-2 text-ink sm:w-24" data-testid={`landing-device-${d}`}>
                  <DeviceIcon type={d} className="h-12 w-14 transition-transform duration-300 group-hover:-translate-y-0.5" />
                  <span className="text-[13px] group-hover:text-link">{t(`devices.${d}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl space-y-5 px-4 py-14 sm:py-20">
        {/* How it works */}
        <section id="how" className="scroll-mt-16">
          <h2 className="display text-center text-[32px] sm:text-[48px]">{t('landing.how')}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {steps.map((s, i) => (
              <div key={i} className="tile lift p-7">
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-semibold text-ink-3">0{i + 1}</span>
                  <s.icon className="size-6" style={{ color: 'var(--brand-primary)' }} />
                </div>
                <p className="mt-6 text-[24px] leading-tight font-semibold tracking-tight">{s.title}</p>
                <p className="mt-2 text-[17px] text-ink-3">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section className="pt-10">
          <h2 className="display text-center text-[32px] sm:text-[48px]">{t('landing.trustTitle')}</h2>
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

        {tenant.branding.about ? (
          <section className="pt-10 text-center">
            <h2 className="display text-[28px] sm:text-[40px]">
              {t('landing.about', { shop: tenant.branding.display_name })}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-relaxed text-ink-2">{tenant.branding.about}</p>
          </section>
        ) : null}
      </div>

      {/* Dark band */}
      <section className="bg-black text-[#f5f5f7]">
        <div className="mx-auto max-w-3xl px-5 py-20 text-center sm:py-28">
          <h2 className="display text-[36px] sm:text-[56px]">{t('landing.bandTitle')}</h2>
          <p className="mx-auto mt-5 max-w-xl text-[19px] leading-snug text-white/70">{t('landing.bandBody')}</p>
          {tenant.settings.warranty_days ? (
            <p className="mt-6 text-[17px] font-semibold text-[#2997ff]">{t('landing.warranty', { days: tenant.settings.warranty_days })}</p>
          ) : null}
        </div>
      </section>

      <div className="mx-auto max-w-5xl space-y-5 px-4 py-14 sm:py-20">
        {parts.length ? (
          <section>
            <h2 className="display text-center text-[32px] sm:text-[48px]">{t('landing.prices')}</h2>
            <p className="mt-2 text-center text-[17px] text-ink-3">{t('landing.pricesNote')}</p>
            <div className="mt-8 gap-4 md:columns-2">
              {families.map((f) => (
                <div key={f} className="tile mb-4 break-inside-avoid p-6">
                  <p className="eyebrow">{f === 'iphone' ? 'iPhone' : f === 'macbook' ? 'MacBook' : f === 'ipad' ? 'iPad' : f === 'imac' ? 'iMac' : f === 'other' ? 'Services' : f.replace('_', ' ')}</p>
                  <ul className="incl mt-3 text-[15px]">
                    {parts
                      .filter((p) => ((p.device_family as string | null) ?? 'other') === f)
                      .map((p) => (
                        <li key={p.name}>
                          <span>{p.name}</span>
                          <span className="shrink-0 font-medium tabular-nums">{formatKes(Number(p.default_price_cents))}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="tile p-6">
            <p className="eyebrow">{t('landing.contact')}</p>
            <p className="mt-3 text-[19px] font-semibold tracking-tight">{tenant.settings.address_formatted}</p>
            {tenant.settings.address_landmark ? <p className="mt-1 text-[15px] text-ink-3">{tenant.settings.address_landmark}</p> : null}
            <a href={`tel:${tenant.settings.contact_phone}`} className="link-more mt-4 inline-block text-[17px]">
              {formatKenyanPhone(tenant.settings.contact_phone)}
            </a>
            {tenant.settings.service_zones.length ? (
              <div className="mt-5">
                <p className="text-[13px] text-ink-3">{t('landing.serviceArea')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tenant.settings.service_zones.map((z) => (
                    <span key={z} className="rounded-full bg-canvas px-3 py-1 text-[13px]">
                      {z}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="tile p-6">
            <p className="eyebrow">{t('landing.hours')}</p>
            <ul className="incl mt-3 text-[15px]">
              {[...WEEKDAYS.slice(1), WEEKDAYS[0]].map((d) => {
                const h = tenant.settings.opening_hours[d];
                return (
                  <li key={d}>
                    <span className="capitalize">{d}</span>
                    <span className={h ? 'tabular-nums' : 'text-ink-3'}>{h ? `${h.open} – ${h.close}` : t('landing.closed')}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <FaqList faqs={faqs} />

        <div className="tile flex flex-col items-center gap-4 px-6 py-12 text-center">
          <h2 className="display text-[28px] sm:text-[40px]">{t('landing.hero')}</h2>
          <Link href="/book" className="inline-flex h-12 items-center rounded-full px-7 text-[17px]" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
            {t('landing.cta')}
          </Link>
        </div>
      </div>

    </div>
  );
}
