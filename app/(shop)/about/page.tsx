import Link from 'next/link';
import type { Metadata } from 'next';
import { InstagramEmbeds } from '@/components/instagram-embeds';
import { GoogleReviews } from '@/components/google-reviews';
import { JsonLd } from '@/components/seo-bits';
import { WhatsAppLink } from '@/components/whatsapp';
import { formatKenyanPhone } from '@/lib/core/phone';
import { WEEKDAYS } from '@/lib/core/time';
import { DEVICE_LABEL, cityOf, enabledDevices, socialLinks, whatsappLink } from '@/lib/public-data';
import { breadcrumbJsonLd, pageMetadata } from '@/lib/seo';
import { requireTenant } from '@/lib/tenant';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await requireTenant();
  const name = tenant.branding.display_name;
  return pageMetadata(tenant, {
    title: `About ${name} — ${cityOf(tenant)} device repair`,
    description: tenant.branding.about ?? `${name}: who we are, where to find us, opening hours and how to reach us.`,
    path: '/about',
  });
}

/** About the shop: story, where and when, socials, and (on request) its Instagram posts. */
export default async function AboutPage() {
  const tenant = await requireTenant();
  const s = tenant.settings;
  const b = tenant.branding;
  const socials = socialLinks(tenant);
  const instagram = socials.find((l) => l.key === 'instagram');
  const hours = WEEKDAYS.map((d) => ({ day: d, h: s.opening_hours[d] }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      <JsonLd data={breadcrumbJsonLd(tenant, [{ name: 'Home', path: '/' }, { name: 'About', path: '/about' }])} />
      <p className="eyebrow">About</p>
      <h1 className="display mt-2 text-[36px] sm:text-[56px]">{b.display_name}</h1>
      {b.tagline ? <p className="mt-2 text-[19px] text-ink-2">{b.tagline}</p> : null}
      {b.about ? <p className="mt-6 max-w-2xl text-[17px] leading-relaxed whitespace-pre-line text-ink-2">{b.about}</p> : null}

      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="tile p-6">
          <p className="eyebrow">Find us</p>
          <p className="mt-3 text-[15px]">{s.address_formatted}</p>
          {s.address_landmark ? <p className="text-[14px] text-ink-3">{s.address_landmark}</p> : null}
          {s.address_lat != null && s.address_lng != null ? (
            <a href={`https://www.google.com/maps?q=${s.address_lat},${s.address_lng}`} target="_blank" rel="noopener" className="mt-2 inline-block text-[14px] text-link hover:underline">
              Open in Google Maps
            </a>
          ) : null}
        </div>
        <div className="tile p-6">
          <p className="eyebrow">Opening hours</p>
          <ul className="mt-3 space-y-1 text-[15px]">
            {hours.map(({ day, h }) => (
              <li key={day} className="flex justify-between gap-3">
                <span className="capitalize">{day}</span>
                <span className="tabular-nums text-ink-2">{h ? `${h.open} – ${h.close}` : 'Closed'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="tile p-6">
          <p className="eyebrow">Get in touch</p>
          <ul className="mt-3 space-y-2 text-[15px]">
            <li>
              <a href={`tel:${s.contact_phone}`} className="hover:underline">
                {formatKenyanPhone(s.contact_phone)}
              </a>
            </li>
            <li>
              <WhatsAppLink href={whatsappLink(tenant, `Hi ${b.display_name}, I have a question.`)} className="hover:underline">
                WhatsApp
              </WhatsAppLink>
            </li>
            {s.contact_email ? (
              <li>
                <a href={`mailto:${s.contact_email}`} className="hover:underline">
                  {s.contact_email}
                </a>
              </li>
            ) : null}
            {socials.map((l) => (
              <li key={l.key}>
                <a href={l.url} target="_blank" rel="noopener me" className="hover:underline">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section className="mt-10">
        <p className="eyebrow">We repair</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {enabledDevices(tenant).map((d) => (
            <Link key={d} href={`/repairs/${d}`} className="rounded-full bg-canvas px-4 py-2 text-[14px] hover:bg-fill">
              {DEVICE_LABEL[d]}
            </Link>
          ))}
        </div>
      </section>

      {b.instagram_posts?.length ? (
        <section className="mt-12">
          <h2 className="display text-[28px] sm:text-[40px]">On Instagram</h2>
          <div className="mt-6">
            <InstagramEmbeds posts={b.instagram_posts} profileUrl={instagram?.url} />
          </div>
        </section>
      ) : null}

      {b.google_place_id ? (
        <section className="mt-12">
          <h2 className="display text-[28px] sm:text-[40px]">What customers say</h2>
          <div className="mt-6">
            <GoogleReviews placeId={b.google_place_id} shopName={b.display_name} />
          </div>
        </section>
      ) : null}

      <div className="tile mt-12 flex flex-col items-center gap-4 px-6 py-12 text-center">
        <h2 className="display text-[28px] sm:text-[40px]">Need a repair?</h2>
        <Link href="/book" className="inline-flex h-12 items-center rounded-full px-7 text-[17px]" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>
          Book a repair pickup
        </Link>
      </div>
    </div>
  );
}
