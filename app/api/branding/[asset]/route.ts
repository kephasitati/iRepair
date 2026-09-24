import { getObject } from '@/lib/storage';
import { getTenant } from '@/lib/tenant';

/** Tenant logo / icon (branding is the only public content; everything else needs a signed URL). */
export async function GET(_req: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const tenant = await getTenant();
  if (!tenant) return new Response('not found', { status: 404 });
  const key = asset === 'logo' ? tenant.branding.logo_path : asset === 'icon' ? tenant.branding.icon_path : null;
  if (!key) return new Response('not found', { status: 404 });
  try {
    const body = await getObject(key);
    const type = key.endsWith('.png') ? 'image/png' : key.endsWith('.svg') ? 'image/svg+xml' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'cache-control': 'public, max-age=300' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
