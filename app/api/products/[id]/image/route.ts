import { getObject } from '@/lib/storage';
import { servicePool } from '@/lib/db';
import { getTenant } from '@/lib/tenant';

/** A listed product's own image copy. Public content (like branding), but only for the requesting host's shop. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tenant = await getTenant();
  if (!tenant || !/^[0-9a-f-]{36}$/.test(id)) return new Response('not found', { status: 404 });
  const [row] = await servicePool()`select image_path from parts_catalogue where id = ${id} and tenant_id = ${tenant.id} and listed and active`;
  const key = row?.image_path as string | null | undefined;
  if (!key) return new Response('not found', { status: 404 });
  try {
    const body = await getObject(key);
    const type = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : key.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
    return new Response(new Uint8Array(body), { headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}
