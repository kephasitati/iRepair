import type { Metadata } from 'next';
import type { DeviceType } from './core/device-id';
import type { Faq } from './faq';
import { cityOf, DEVICE_LABEL, whatsappNumber, type PublicPart } from './public-data';
import type { Tenant } from './tenant';

/** Metadata and schema.org JSON-LD for the public pages of a shop (SEO / AEO / GEO). */

export function absoluteUrl(tenant: Tenant, path = '/') {
  return `${tenant.baseUrl}${path}`;
}

export function pageMetadata(tenant: Tenant, input: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  const url = absoluteUrl(tenant, input.path);
  const name = tenant.branding.display_name;
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      url,
      siteName: name,
      title: input.title,
      description: input.description,
      locale: 'en_KE',
      images: [{ url: absoluteUrl(tenant, '/opengraph-image'), width: 1200, height: 630, alt: name }],
    },
    twitter: { card: 'summary_large_image', title: input.title, description: input.description },
    robots: { index: true, follow: true },
  };
}

const DAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export function localBusinessJsonLd(tenant: Tenant, parts: PublicPart[], rating: { average: number; count: number }) {
  const s = tenant.settings;
  const url = absoluteUrl(tenant);
  const prices = parts.map((p) => p.default_price_cents / 100);
  return {
    '@context': 'https://schema.org',
    '@type': ['LocalBusiness', 'ElectronicsStore'],
    '@id': `${url}#business`,
    name: tenant.branding.display_name,
    description: tenant.branding.about ?? tenant.branding.tagline ?? undefined,
    url,
    logo: tenant.branding.logo_path ? absoluteUrl(tenant, '/api/branding/logo') : undefined,
    image: absoluteUrl(tenant, '/opengraph-image'),
    telephone: s.contact_phone,
    email: s.contact_email ?? undefined,
    priceRange: prices.length ? `KES ${Math.min(...prices).toLocaleString('en-KE')} – ${Math.max(...prices).toLocaleString('en-KE')}` : undefined,
    currenciesAccepted: 'KES',
    paymentAccepted: 'M-Pesa',
    address: { '@type': 'PostalAddress', streetAddress: s.address_formatted, addressLocality: cityOf(tenant), addressCountry: 'KE' },
    geo: s.address_lat != null && s.address_lng != null ? { '@type': 'GeoCoordinates', latitude: s.address_lat, longitude: s.address_lng } : undefined,
    areaServed: (s.service_zones.length ? s.service_zones : [cityOf(tenant)]).map((z) => ({ '@type': 'Place', name: `${z}, ${cityOf(tenant)}` })),
    openingHoursSpecification: Object.entries(s.opening_hours)
      .filter(([, h]) => h)
      .map(([d, h]) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${DAY_NAMES[d]}`, opens: h!.open, closes: h!.close })),
    contactPoint: [
      { '@type': 'ContactPoint', contactType: 'customer support', telephone: s.contact_phone, areaServed: 'KE', availableLanguage: ['English', 'Swahili'] },
      { '@type': 'ContactPoint', contactType: 'customer support', url: `https://wa.me/${whatsappNumber(tenant)}`, name: 'WhatsApp' },
    ],
    aggregateRating: rating.count >= 1 ? { '@type': 'AggregateRating', ratingValue: rating.average.toFixed(1), reviewCount: rating.count, bestRating: 5, worstRating: 1 } : undefined,
    hasOfferCatalog: parts.length
      ? {
          '@type': 'OfferCatalog',
          name: 'Repair services',
          itemListElement: parts.map((p) => ({
            '@type': 'Offer',
            price: (p.default_price_cents / 100).toFixed(0),
            priceCurrency: 'KES',
            itemOffered: { '@type': 'Service', name: p.name, category: p.device_family ? DEVICE_LABEL[p.device_family as DeviceType] ?? p.device_family : undefined },
          })),
        }
      : undefined,
    potentialAction: { '@type': 'ReserveAction', target: absoluteUrl(tenant, '/book'), name: 'Book a repair pickup' },
  };
}

export function faqJsonLd(faqs: Faq[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };
}

export function deviceServiceJsonLd(tenant: Tenant, device: DeviceType, parts: PublicPart[]) {
  const label = DEVICE_LABEL[device];
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: `${label} repair in ${cityOf(tenant)} with doorstep pickup`,
    serviceType: `${label} repair`,
    provider: { '@id': `${absoluteUrl(tenant)}#business` },
    areaServed: { '@type': 'City', name: cityOf(tenant) },
    url: absoluteUrl(tenant, `/repairs/${device}`),
    offers: parts
      .filter((p) => p.device_family === device)
      .map((p) => ({ '@type': 'Offer', name: p.name, price: (p.default_price_cents / 100).toFixed(0), priceCurrency: 'KES' })),
  };
}

export function breadcrumbJsonLd(tenant: Tenant, items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: absoluteUrl(tenant, it.path) })),
  };
}
