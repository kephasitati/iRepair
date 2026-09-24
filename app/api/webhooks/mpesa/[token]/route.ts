import { handleMpesaCallback } from '@/lib/jobs/payments';

export const dynamic = 'force-dynamic';

/** Safaricom Daraja STK callback. The per-payment token in the URL is the only authentication Daraja allows. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = await req.text();
  const headers = Object.fromEntries(req.headers.entries());
  const res = await handleMpesaCallback(token, raw, headers);
  return Response.json(res.body, { status: res.status });
}
