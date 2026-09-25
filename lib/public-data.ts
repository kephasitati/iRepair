import 'server-only';
import { cache } from 'react';
import { DEFAULT_DEVICE_TYPES, type DeviceType } from './core/device-id';
import { servicePool } from './db';
import type { Tenant } from './tenant';

/** Public, cacheable facts about a shop for landing pages, structured data and llms.txt. Never includes customer data. */

export type PublicPart = { name: string; device_family: string | null; default_price_cents: number };

export const getPublishedCatalogue = cache(async (tenantId: string): Promise<PublicPart[]> => {
  const rows = await servicePool()`select name, device_family, default_price_cents from parts_catalogue
    where tenant_id = ${tenantId} and published and active
    order by array_position(array['iphone','macbook','ipad','imac','apple_watch','android','windows_laptop','other']::text[], device_family), default_price_cents`;
  return rows.map((r) => ({ name: r.name, device_family: r.device_family, default_price_cents: Number(r.default_price_cents) }));
});

export const getRatingSummary = cache(async (tenantId: string): Promise<{ average: number; count: number; recent: { score: number; comment: string | null; created_at: string }[] }> => {
  const [agg] = await servicePool()`select coalesce(avg(score), 0)::float as average, count(*)::int as count from ratings where tenant_id = ${tenantId}`;
  const recent = await servicePool()`select score, comment, created_at from ratings where tenant_id = ${tenantId} and comment is not null and score >= 4 order by created_at desc limit 3`;
  return { average: Number(agg.average), count: Number(agg.count), recent: recent as unknown as { score: number; comment: string | null; created_at: string }[] };
});

export type PublicProduct = {
  id: string;
  name: string;
  device_family: string | null;
  category: string | null;
  description: string | null;
  default_price_cents: number;
  image_path: string | null;
  image_url: string | null;
};

const PRODUCT_COLS = 'id, name, device_family, category, description, default_price_cents, image_path, image_url';

/** Everything a shop lists on its /shop page (only when `settings.shop_page` is on). */
export const getListedProducts = cache(async (tenantId: string): Promise<PublicProduct[]> => {
  const rows = await servicePool().unsafe(
    `select ${PRODUCT_COLS} from parts_catalogue where tenant_id = $1 and listed and active
     order by array_position(array['iphone','macbook','ipad','imac','apple_watch','android','windows_laptop','other']::text[], device_family), category, name`,
    [tenantId],
  );
  return rows.map((r) => ({ ...(r as unknown as PublicProduct), default_price_cents: Number(r.default_price_cents) }));
});

export const getListedProduct = cache(async (tenantId: string, id: string): Promise<PublicProduct | null> => {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [r] = await servicePool().unsafe(`select ${PRODUCT_COLS} from parts_catalogue where tenant_id = $1 and id = $2 and listed and active`, [tenantId, id]);
  return r ? { ...(r as unknown as PublicProduct), default_price_cents: Number(r.default_price_cents) } : null;
});

/** Our own copy first; the source website's image until one exists. */
export function productImageSrc(p: PublicProduct): string | null {
  return p.image_path ? `/api/products/${p.id}/image` : p.image_url;
}

export const getTenantFaqs = cache(async (tenantId: string): Promise<{ q: string; a: string }[]> => {
  const rows = await servicePool()`select question, answer from tenant_faqs where tenant_id = ${tenantId} order by position, created_at`;
  return rows.map((r) => ({ q: r.question as string, a: r.answer as string }));
});

export function enabledDevices(tenant: Tenant): DeviceType[] {
  return tenant.settings.device_types?.length ? tenant.settings.device_types : DEFAULT_DEVICE_TYPES;
}

export const DEVICE_LABEL: Record<DeviceType, string> = {
  iphone: 'iPhone',
  macbook: 'MacBook',
  ipad: 'iPad',
  imac: 'iMac',
  apple_watch: 'Apple Watch',
  android: 'Android phone',
  windows_laptop: 'Windows laptop',
  other: 'device',
};

/** "Nairobi" plus the shop's zones, used in titles and areaServed. */
export function cityOf(tenant: Tenant): string {
  return /nairobi/i.test(tenant.settings.address_formatted) || !tenant.settings.address_formatted ? 'Nairobi' : tenant.settings.address_formatted.split(',').at(-1)!.trim();
}

export function whatsappNumber(tenant: Tenant): string {
  return (tenant.settings.whatsapp_phone ?? tenant.settings.contact_phone).replace(/^\+/, '');
}

export function whatsappLink(tenant: Tenant, text?: string): string {
  return `https://wa.me/${whatsappNumber(tenant)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}
