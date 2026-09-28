import { requestCtx } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { withUser } from '@/lib/db';
import { signedDownloadUrl } from '@/lib/storage';
import { getTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * The customer's ID photo: a 5-minute signed URL for the customer themself or the shop's staff (RLS decides).
 * A staff view is an access to an identity document, so it is written to the audit log.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(userId)) return new Response('not found', { status: 404 });
  const [ctx, tenant] = await Promise.all([requestCtx(), getTenant()]);
  if (!ctx.userId || !tenant) return new Response('unauthorized', { status: 401 });
  const key = await withUser(ctx, async (tx) => {
    const [r] = await tx`select photo_path from customer_ids where tenant_id = ${tenant.id} and user_id = ${userId}`;
    if (!r?.photo_path) return null;
    if (ctx.userId !== userId) await audit(tx, { tenantId: tenant.id, actorUserId: ctx.userId, action: 'customer_id.photo_view', entity: 'user', entityId: userId });
    return r.photo_path as string;
  });
  if (!key) return new Response('not found', { status: 404 });
  return Response.redirect(await signedDownloadUrl(key), 302);
}
