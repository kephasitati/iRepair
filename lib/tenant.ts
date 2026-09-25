import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { servicePool } from './db';
import { env } from './env';

/**
 * Tenant resolution from the Host header (DECISIONS D-8). One lookup per request (React cache) on top of a
 * 60-second in-process cache so a settings change shows up quickly on every instance.
 */

export type OpeningHours = Record<string, { open: string; close: string } | null>;

export type Tenant = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  hostname: string;
  baseUrl: string;
  branding: {
    display_name: string;
    tagline: string | null;
    logo_path: string | null;
    icon_path: string | null;
    primary_hex: string;
    accent_hex: string;
    sms_sender_id: string | null;
    email_from_name: string | null;
    about: string | null;
  };
  settings: {
    contact_phone: string;
    contact_email: string | null;
    address_formatted: string;
    address_lat: number | null;
    address_lng: number | null;
    address_landmark: string | null;
    kra_pin: string | null;
    vat_registered: boolean;
    vat_rate_bp: number;
    prices_include_vat: boolean;
    consultation_fee_cents: number;
    consultation_fee_credited: boolean;
    deposit_rule: { kind: 'percent' | 'fixed'; value: number };
    deposit_min_quote_cents: number;
    max_negotiation_rounds: number;
    quote_expiry_hours: number;
    expired_quote_autodecline_days: number;
    delivery_markup_bp: number;
    delivery_provider: 'mock' | 'tumaboda';
    retention_days: number;
    quiet_hours_start: string;
    quiet_hours_end: string;
    opening_hours: OpeningHours;
    service_zones: string[];
    publish_price_list: boolean;
    auto_close_hours: number;
    warranty_days: number;
    unclaimed_after_days: number;
    require_admin_mfa: boolean;
    collect_supplementary_upfront: boolean;
    device_types: import('./core/device-id').DeviceType[];
    whatsapp_phone: string | null;
  };
};

type CacheEntry = { at: number; value: Tenant | null };
const memo = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export function invalidateTenantCache(hostname?: string) {
  if (hostname) memo.delete(hostname);
  else memo.clear();
}

function toNumber<T extends Record<string, unknown>>(row: T, keys: string[]): T {
  for (const k of keys) if (row[k] != null) (row as Record<string, unknown>)[k] = Number(row[k]);
  return row;
}

export async function loadTenantByHost(hostname: string): Promise<Tenant | null> {
  const hit = memo.get(hostname);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const sql = servicePool();
  const rows = await sql`
    select t.id, t.slug, t.name, t.status, d.hostname,
           row_to_json(b.*) as branding, row_to_json(s.*) as settings
    from tenant_domains d
    join tenants t on t.id = d.tenant_id
    join tenant_branding b on b.tenant_id = t.id
    join tenant_settings s on s.tenant_id = t.id
    where d.hostname = ${hostname}
    limit 1`;
  let value: Tenant | null = null;
  if (rows[0]) {
    const r = rows[0];
    const scheme = /localhost|127\.0\.0\.1/.test(hostname) ? 'http' : 'https';
    const settings = toNumber(r.settings, [
      'consultation_fee_cents', 'deposit_min_quote_cents', 'vat_rate_bp', 'max_negotiation_rounds', 'quote_expiry_hours',
      'expired_quote_autodecline_days', 'delivery_markup_bp', 'retention_days', 'auto_close_hours', 'warranty_days', 'unclaimed_after_days',
    ]);
    settings.quiet_hours_start = String(settings.quiet_hours_start).slice(0, 5);
    settings.quiet_hours_end = String(settings.quiet_hours_end).slice(0, 5);
    value = { id: r.id, slug: r.slug, name: r.name, status: r.status, hostname, baseUrl: `${scheme}://${hostname}`, branding: r.branding, settings };
  }
  memo.set(hostname, { at: Date.now(), value });
  return value;
}

export async function loadTenantById(id: string): Promise<Tenant | null> {
  const [d] = await servicePool()`select hostname from tenant_domains where tenant_id = ${id} and is_primary`;
  return d ? loadTenantByHost(d.hostname) : null;
}

export const currentHost = cache(async () => {
  const h = await headers();
  return (h.get('x-forwarded-host') ?? h.get('host') ?? '').toLowerCase();
});

export function isPlatformHost(host: string) {
  return host === env().PLATFORM_ROOT_DOMAIN.toLowerCase();
}

/** The tenant for this request, or null on the platform host. Unknown hosts 404. */
export const getTenant = cache(async (): Promise<Tenant | null> => {
  const host = await currentHost();
  if (!host || isPlatformHost(host)) return null;
  const t = await loadTenantByHost(host);
  if (!t) notFound();
  return t;
});

export async function requireTenant(): Promise<Tenant> {
  const t = await getTenant();
  if (!t) notFound();
  return t;
}
