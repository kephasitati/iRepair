import { NextResponse } from 'next/server';
import { formatKes } from '@/lib/core/money';
import { generalFaqs } from '@/lib/faq';
import { cityOf, DEVICE_LABEL, enabledDevices, getPublishedCatalogue, getTenantFaqs, whatsappNumber } from '@/lib/public-data';
import { requireTenant } from '@/lib/tenant';

/**
 * Plain-text summary for AI assistants and crawlers (GEO). Convention: https://llmstxt.org.
 * Mirrors exactly what's true in the database, so it never claims a price or policy the app doesn't enforce.
 */
export async function GET() {
  const tenant = await requireTenant();
  const parts = tenant.settings.publish_price_list ? await getPublishedCatalogue(tenant.id) : [];
  const customFaqs = await getTenantFaqs(tenant.id);
  const faqs = customFaqs.length ? customFaqs : generalFaqs(tenant, parts);
  const name = tenant.branding.display_name;
  const devices = enabledDevices(tenant).map((d) => DEVICE_LABEL[d]);

  const lines: string[] = [
    `# ${name}`,
    '',
    tenant.branding.about ?? tenant.branding.tagline ?? `${name} repairs phones, tablets and computers with doorstep pickup and return in ${cityOf(tenant)}, Kenya.`,
    '',
    '## What we repair',
    ...devices.map((d) => `- ${d}`),
    '',
    '## How booking works',
    '1. Book online and pay the pickup fee by M-Pesa.',
    `2. A TumaBoda rider collects the device from the customer's door in ${cityOf(tenant)}.`,
    '3. The shop diagnoses it and sends an itemised quote. Nothing is repaired until the customer accepts.',
    '4. The customer pays the deposit by M-Pesa, the repair is done, and a rider returns the device (or the customer collects it).',
    '',
  ];

  if (parts.length) {
    lines.push('## Sample prices (KES, VAT inclusive where applicable)', ...parts.slice(0, 24).map((p) => `- ${p.name}: ${formatKes(p.default_price_cents)}`), '');
  }

  lines.push('## Frequently asked questions');
  for (const f of faqs) lines.push(`Q: ${f.q}`, `A: ${f.a}`, '');

  lines.push(
    '## Contact',
    `Phone: ${tenant.settings.contact_phone}`,
    `WhatsApp: https://wa.me/${whatsappNumber(tenant)}`,
    `Address: ${tenant.settings.address_formatted}`,
    `Website: ${tenant.baseUrl}`,
    '',
    `${name} is an independent repair service and is not affiliated with or endorsed by Apple Inc., Samsung, Microsoft or any other device manufacturer named above.`,
  );

  return new NextResponse(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
