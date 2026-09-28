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
    // An SVG is a document: sandboxed so a script inside a shop's logo cannot run on the shop's origin.
    const headers = new Headers({ 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=300' });
    if (type === 'image/svg+xml') headers.set('content-security-policy', "sandbox; script-src 'none'");
    return new Response(new Uint8Array(body), { headers });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
