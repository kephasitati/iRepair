import { requestCtx } from '@/lib/auth';
import { withUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

/** Payment status for the pay panel (polled every 2 s while a prompt is open). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requestCtx();
  if (!ctx.userId) return new Response('unauthorized', { status: 401 });
  const [p] = await withUser(ctx, (tx) => tx`select id, status, result_code, result_desc, mpesa_receipt, amount_cents, purpose from payments where id = ${id}`);
  if (!p) return new Response('not found', { status: 404 });
  return Response.json({ ...p, amount_cents: Number(p.amount_cents) }, { headers: { 'cache-control': 'no-store' } });
}
