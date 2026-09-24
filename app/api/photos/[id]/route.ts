import { requestCtx } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { signedDownloadUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Redirects to a 5-minute signed URL if (and only if) RLS lets the viewer see the photo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('not found', { status: 404 });
  const ctx = await requestCtx();
  if (!ctx.userId) return new Response('unauthorized', { status: 401 });
  const [p] = await withUser(ctx, (tx) => tx`select storage_key from job_photos where id = ${id} and deleted_at is null`);
  if (!p) return new Response('not found', { status: 404 });
  return Response.redirect(await signedDownloadUrl(p.storage_key), 302);
}
