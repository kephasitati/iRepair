import { requestCtx } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { getObject } from '@/lib/storage';
import { generateInvoicePdf } from '@/worker/tasks';

export const dynamic = 'force-dynamic';

/** Streams the invoice PDF if the viewer may see the invoice (RLS). Generates it on demand if the worker has not yet. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requestCtx();
  if (!ctx.userId) return new Response('unauthorized', { status: 401 });
  const [inv] = await withUser(ctx, (tx) => tx`select id, number, status, pdf_key from invoices where id = ${id}`);
  if (!inv) return new Response('not found', { status: 404 });
  let key: string | null = inv.pdf_key;
  if (!key || inv.status === 'proforma') {
    await generateInvoicePdf(inv.id);
    const [again] = await withUser(ctx, (tx) => tx`select pdf_key from invoices where id = ${id}`);
    key = again.pdf_key;
  }
  const pdf = await getObject(key!);
  const name = `${inv.number ?? 'proforma-' + String(inv.id).slice(0, 8)}.pdf`;
  return new Response(new Uint8Array(pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'private, no-store' } });
}
