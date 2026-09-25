import type { MetadataRoute } from 'next';
import { getTenant } from '@/lib/tenant';

/** Per-shop robots.txt. The platform console host is kept out of search entirely. */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const tenant = await getTenant();
  if (!tenant) return { rules: { userAgent: '*', disallow: '/' } };
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/book', '/jobs', '/account', '/admin', '/bench', '/platform', '/staff', '/api', '/l/', '/track', '/dev'],
    },
    sitemap: `${tenant.baseUrl}/sitemap.xml`,
  };
}
