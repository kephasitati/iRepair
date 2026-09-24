import type { MetadataRoute } from 'next';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';

/** Per-shop PWA manifest: the customer installs "<Shop name>", never the platform brand. */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const tenant = await getTenant();
  const name = tenant?.branding.display_name ?? env().PLATFORM_NAME;
  const primary = tenant?.branding.primary_hex ?? '#0f172a';
  const icon = tenant?.branding.icon_path ? '/api/branding/icon' : '/icon.svg';
  return {
    name,
    short_name: name.length > 12 ? name.split(' ')[0] : name,
    description: tenant?.branding.tagline ?? 'Device repair with doorstep pickup and return.',
    start_url: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: primary,
    icons: [
      { src: icon, sizes: 'any', type: tenant?.branding.icon_path ? 'image/png' : 'image/svg+xml', purpose: 'any' },
      { src: icon, sizes: '512x512', type: tenant?.branding.icon_path ? 'image/png' : 'image/svg+xml', purpose: 'maskable' },
    ],
  };
}
