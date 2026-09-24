import { requestCtx } from '@/lib/auth';
import { withUser } from '@/lib/db';
import { isProd } from '@/lib/env';
import { handleMpesaCallback } from '@/lib/jobs/payments';

export const dynamic = 'force-dynamic';

/**
 * M-Pesa simulator (MPESA_DRIVER=simulator, never in production): plays the role of the customer's phone and
 * Safaricom, posting a real-shaped STK callback through the same handler Daraja would hit.
 */
export async function POST(req: Request) {
  if (isProd()) return new Response('not found', { status: 404 });
  const { paymentId, outcome } = (await req.json()) as { paymentId: string; outcome: 'success' | 'cancelled' | 'insufficient' };
  const ctx = await requestCtx();
  const [p] = await withUser(ctx, (tx) => tx`select id from payments where id = ${paymentId}`);
  if (!p) return new Response('not found', { status: 404 });
  // read the token with the service role inside the handler path
  const { servicePool } = await import('@/lib/db');
  const [full] = await servicePool()`select * from payments where id = ${paymentId}`;
  if (!full.checkout_request_id) return new Response('not pending', { status: 409 });
  const code = outcome === 'success' ? 0 : outcome === 'cancelled' ? 1032 : 1;
  const body = {
    Body: {
      stkCallback: {
        MerchantRequestID: full.merchant_request_id,
        CheckoutRequestID: full.checkout_request_id,
        ResultCode: code,
        ResultDesc: code === 0 ? 'The service request is processed successfully.' : code === 1032 ? 'Request cancelled by user' : 'The balance is insufficient for the transaction.',
        ...(code === 0
          ? {
              CallbackMetadata: {
                Item: [
                  { Name: 'Amount', Value: Number(full.amount_cents) / 100 },
                  { Name: 'MpesaReceiptNumber', Value: 'SIM' + Math.random().toString(36).slice(2, 9).toUpperCase() },
                  { Name: 'TransactionDate', Value: Number(new Date().toISOString().replace(/\D/g, '').slice(0, 14)) },
                  { Name: 'PhoneNumber', Value: Number(String(full.phone_e164).replace('+', '')) },
                ],
              },
            }
          : {}),
      },
    },
  };
  const res = await handleMpesaCallback(full.callback_token, JSON.stringify(body), { 'x-simulator': '1' });
  return Response.json(res.body, { status: res.status });
}
