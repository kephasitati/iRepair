import type { MetadataRoute } from 'next';
import { enabledDevices } from '@/lib/public-data';
import { getTenant } from '@/lib/tenant';

/** Per-shop sitemap: the landing page, one page per repaired device, and the legal pages. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tenant = await getTenant();
  if (!tenant) return [];
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: tenant.baseUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    ...enabledDevices(tenant).map((d) => ({ url: `${tenant.baseUrl}/repairs/${d}`, lastModified: now, changeFrequency: 'weekly' as const, priority: 0.9 })),
    { url: `${tenant.baseUrl}/terms`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${tenant.baseUrl}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.2 },
  ];
  return pages;
}
