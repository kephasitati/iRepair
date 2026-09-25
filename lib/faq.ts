import { formatKes } from './core/money';
import { MODEL_SUGGESTIONS } from './core/device-models';
import type { DeviceType } from './core/device-id';
import { cityOf, DEVICE_LABEL, enabledDevices, type PublicPart } from './public-data';
import type { Tenant } from './tenant';

/**
 * Answer-first FAQs (AEO/GEO): each answer opens with the direct fact a search or AI assistant would quote, then adds
 * detail. Generated from the shop's real settings and prices so they never drift from what the app enforces.
 * The same list is rendered visibly on the page and as FAQPage structured data.
 */
export type Faq = { q: string; a: string };

function fromPrice(parts: PublicPart[], family: string, match: RegExp): PublicPart | undefined {
  return parts.filter((p) => p.device_family === family && match.test(p.name)).sort((a, b) => a.default_price_cents - b.default_price_cents)[0];
}

export function generalFaqs(tenant: Tenant, parts: PublicPart[]): Faq[] {
  const s = tenant.settings;
  const shop = tenant.branding.display_name;
  const city = cityOf(tenant);
  const devices = enabledDevices(tenant).map((d) => DEVICE_LABEL[d]);
  const screen = fromPrice(parts, 'iphone', /screen/i);
  const faqs: Faq[] = [
    {
      q: `Do I have to bring my device to ${shop}?`,
      a: `No. A TumaBoda rider collects your device from your door${s.service_zones.length ? ` in ${s.service_zones.slice(0, 6).join(', ')}${s.service_zones.length > 6 ? ' and more' : ''}` : ` in ${city}`}, and returns it after the repair. You can also collect it from our workshop at ${s.address_formatted}.`,
    },
    {
      q: `Which devices does ${shop} repair?`,
      a: `${devices.join(', ')}. We handle screens, batteries, charging ports, cameras, Face ID, keyboards, liquid damage and board-level repairs.`,
    },
    {
      q: 'How much does the pickup cost?',
      a: `The pickup fee is the courier fare for your address plus a ${formatKes(s.consultation_fee_cents)} diagnosis fee, shown before you pay.${s.consultation_fee_credited ? ' If you go ahead with the repair, the diagnosis fee is credited against it.' : ''}`,
    },
    ...(screen
      ? [{ q: `How much is an iPhone screen replacement in ${city}?`, a: `iPhone screen replacements at ${shop} start from ${formatKes(screen.default_price_cents)} (${screen.name}), including VAT. You get an itemised quote after diagnosis and nothing is done until you accept it.` }]
      : []),
    {
      q: 'Do I have to accept the quote?',
      a: `No. You can accept it, make up to ${s.max_negotiation_rounds} counter-offers, or decline. If you decline, you pay only the diagnosis fee and the return delivery, and your device comes back to you.`,
    },
    {
      q: 'How do I pay?',
      a: `By M-Pesa, straight to ${shop}'s own Paybill or Till. A ${s.deposit_rule.kind === 'percent' ? `${s.deposit_rule.value / 100}%` : formatKes(s.deposit_rule.value)} deposit starts the repair and the balance is paid before your device is returned. You get an M-Pesa receipt and a tax invoice.`,
    },
    {
      q: 'How do I know my device is safe with the rider?',
      a: 'Every handover is verified by scanning the rider’s TumaBoda QR code in the app, and recorded with the time, the rider and the photos you took. We photograph the device again when it arrives at the bench.',
    },
    ...(s.warranty_days ? [{ q: 'Is there a warranty?', a: `Yes, ${s.warranty_days} days on the parts we fit and our workmanship for the repaired fault.` }] : []),
    {
      q: 'Is my data and passcode safe?',
      a: 'Back up first. If you share your passcode it is encrypted, shown only to the technician working on your device, and deleted when the job closes.',
    },
    {
      q: `Is ${shop} part of Apple?`,
      a: `No. ${shop} is an independent repair service and is not affiliated with or endorsed by Apple Inc.`,
    },
  ];
  return faqs;
}

export function deviceFaqs(tenant: Tenant, device: DeviceType, parts: PublicPart[]): Faq[] {
  const label = DEVICE_LABEL[device];
  const shop = tenant.branding.display_name;
  const city = cityOf(tenant);
  const mine = parts.filter((p) => p.device_family === device);
  const cheapest = mine.slice().sort((a, b) => a.default_price_cents - b.default_price_cents)[0];
  const models = (MODEL_SUGGESTIONS[device] ?? []).slice(0, 8);
  const faqs: Faq[] = [
    {
      q: `How much does ${label} repair cost in ${city}?`,
      a: cheapest
        ? `${label} repairs at ${shop} start from ${formatKes(cheapest.default_price_cents)} (${cheapest.name}). ${mine
            .slice(0, 4)
            .map((p) => `${p.name}: ${formatKes(p.default_price_cents)}`)
            .join('; ')}. Prices include VAT; your exact quote follows diagnosis.`
        : `You get an itemised quote after diagnosis, and nothing is done until you accept it.`,
    },
    {
      q: `Can you collect my ${label} from home or the office?`,
      a: `Yes. Book online, pay the pickup fee by M-Pesa, and a TumaBoda rider collects your ${label} in ${city}. It comes back the same way, or you can collect it.`,
    },
    ...(models.length ? [{ q: `Which ${label} models do you repair?`, a: `All recent models, including ${models.join(', ')}.` }] : []),
    {
      q: `How long does a ${label} repair take?`,
      a: `Your quote states the estimated turnaround before you accept. You can follow every step live in the app.`,
    },
  ];
  return faqs;
}
