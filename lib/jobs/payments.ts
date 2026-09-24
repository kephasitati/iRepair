import 'server-only';
import { randomToken } from '@/lib/core/crypto';
import { centsToKes, isWholeShilling } from '@/lib/core/money';
import { servicePool, withService, withUser, type RequestCtx, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { isSimulatedMpesa, mpesaFor } from '@/lib/providers';
import { parseStkCallback } from '@/lib/providers/mpesa';
import type { Tenant } from '@/lib/tenant';
import { rateLimit } from '@/lib/auth';
import type { JobRow, PaymentPurpose } from './types';
import { UserError } from './types';

/** M-Pesa STK payments (PLAN §6). The amount for each purpose is derived server-side, never trusted from the client. */

export async function amountDue(tx: Tx, job: JobRow, purpose: PaymentPurpose, quoteId?: string | null): Promise<number> {
  switch (purpose) {
    case 'pickup_fee':
      if (job.status !== 'pickup_fee_pending') throw new UserError('The pickup fee is not due right now.');
      return job.pickup_fee_cents;
    case 'deposit': {
      if (job.status !== 'deposit_pending') throw new UserError('The deposit is not due right now.');
      const [v] = await tx`select v.deposit_cents from quotes q join quote_versions v on v.id = q.accepted_version_id where q.job_id = ${job.id} and q.kind = 'main'`;
      return Number(v?.deposit_cents ?? 0);
    }
    case 'final_balance': {
      if (job.status !== 'final_payment_pending') throw new UserError('The balance is not due right now.');
      const [inv] = await tx`select balance_cents from invoices where job_id = ${job.id} and status <> 'void'`;
      return Number(inv?.balance_cents ?? 0);
    }
    case 'return_fee':
      if (job.status !== 'return_fee_pending') throw new UserError('The return fee is not due right now.');
      return job.return_fee_cents;
    case 'supplementary': {
      const [q] = await tx`select accepted_total_cents from quotes where id = ${quoteId ?? null} and job_id = ${job.id} and kind = 'supplementary' and status = 'accepted' and collect_upfront`;
      return Number(q?.accepted_total_cents ?? 0);
    }
  }
}

export type InitiateResult =
  | { ok: true; paymentId: string; checkoutRequestId: string; simulated: boolean; customerMessage: string }
  | { ok: false; error: string };

/**
 * Create the payments row and send the STK push. Runs the DB part as the user (RLS proves they may pay this job)
 * and the provider call outside the transaction.
 */
export async function initiateStkPayment(ctx: RequestCtx, tenant: Tenant, jobId: string, purpose: PaymentPurpose, phoneE164: string, quoteId?: string | null): Promise<InitiateResult> {
  if (!(await rateLimit(`stk:${phoneE164}`, 3, 10 * 60))) return { ok: false, error: 'rate_limited' };

  const prepared = await withUser(ctx, async (tx) => {
    const [job] = (await tx`select * from jobs where id = ${jobId}`) as JobRow[];
    if (!job) throw new UserError('Job not found');
    const amount = await amountDue(tx, job, purpose, quoteId);
    if (amount <= 0) throw new UserError('Nothing to pay.');
    if (!isWholeShilling(amount)) throw new Error(`Amount ${amount} is not a whole shilling`);
    const [{ n }] = await tx`select count(*)::int as n from payments where job_id = ${jobId} and purpose = ${purpose}`;
    return { job, amount, attempt: Number(n) + 1 };
  });

  const callbackToken = randomToken(24);
  const payment = await withService(async (tx) => {
    // still pending prompt for the same purpose? refuse a second one for 60 s so the customer is not double-prompted
    const [pending] = await tx`select id from payments where job_id = ${jobId} and purpose = ${purpose} and status in ('initiated', 'pending') and created_at > now() - interval '60 seconds'`;
    if (pending) throw new UserError('A payment prompt was just sent. Check your phone or wait a minute to retry.');
    const [p] = await tx`insert into payments (tenant_id, job_id, quote_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, created_by)
      values (${tenant.id}, ${jobId}, ${quoteId ?? null}, ${purpose}, ${prepared.amount}, ${phoneE164}, ${`${jobId}:${purpose}:${prepared.attempt}:${Date.now()}`}, ${callbackToken}, ${ctx.userId})
      returning id`;
    return p;
  });

  const gateway = await mpesaFor(tenant);
  const simulated = isSimulatedMpesa(gateway);
  const base = env().MPESA_CALLBACK_BASE_URL ?? tenant.baseUrl;
  try {
    const res = await gateway.stkPush({
      amountKes: centsToKes(prepared.amount),
      phoneE164,
      accountReference: prepared.job.ref,
      description: purpose.replace('_', ' '),
      callbackUrl: `${base}/api/webhooks/mpesa/${callbackToken}`,
    });
    await withService(async (tx) => {
      await tx`update payments set status = 'pending', merchant_request_id = ${res.merchantRequestId}, checkout_request_id = ${res.checkoutRequestId} where id = ${payment.id}`;
      await tx`insert into timers (tenant_id, job_id, payment_id, kind, due_at) values (${tenant.id}, ${jobId}, ${payment.id}, 'payment_reconcile', now() + interval '2 minutes')`;
    });
    return { ok: true, paymentId: payment.id, checkoutRequestId: res.checkoutRequestId, simulated, customerMessage: res.customerMessage };
  } catch (e) {
    await servicePool()`update payments set status = 'failed', result_desc = ${(e as Error).message.slice(0, 300)} where id = ${payment.id}`;
    return { ok: false, error: (e as Error).message };
  }
}

/** Daraja callback: look up by callback token, then let confirm_payment() do the rest inside one transaction. */
export async function handleMpesaCallback(token: string, rawBody: string, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const sql = servicePool();
  const parsed = (() => {
    try {
      return parseStkCallback(JSON.parse(rawBody));
    } catch {
      return null;
    }
  })();
  const dedupe = parsed ? `mpesa:${parsed.checkoutRequestId}:${parsed.resultCode}:${parsed.receipt ?? ''}` : null;
  const [evt] = await sql`insert into webhook_events (source, dedupe_key, headers, raw_body, signature_valid) values ('mpesa', ${dedupe}, ${sql.json(headers as never)}, ${rawBody}, null)
    on conflict (dedupe_key) do nothing returning id`;
  if (!parsed) {
    await sql`update webhook_events set error = 'bad shape', processed_at = now() where id = ${evt?.id ?? null}`;
    return { status: 400, body: { ResultCode: 1, ResultDesc: 'Rejected' } };
  }
  if (!evt) return { status: 200, body: { ResultCode: 0, ResultDesc: 'Duplicate' } };

  try {
    await withService(async (tx) => {
      const [p] = await tx`select id, callback_token from payments where checkout_request_id = ${parsed.checkoutRequestId}`;
      if (!p || p.callback_token !== token) throw new Error('unknown payment or bad token');
      await tx`update webhook_events set tenant_id = (select tenant_id from payments where id = ${p.id}), signature_valid = true where id = ${evt.id}`;
      await tx`select confirm_payment(${parsed.checkoutRequestId}, ${parsed.resultCode}, ${parsed.resultDesc}, ${parsed.receipt ?? null},
        ${parsed.amountKes != null ? Math.round(parsed.amountKes * 100) : null}, ${tx.json(JSON.parse(rawBody))})`;
      await tx`update webhook_events set processed_at = now() where id = ${evt.id}`;
    });
    return { status: 200, body: { ResultCode: 0, ResultDesc: 'Accepted' } };
  } catch (e) {
    await sql`update webhook_events set error = ${(e as Error).message.slice(0, 500)}, processed_at = now() where id = ${evt.id}`;
    // Always 200 to Safaricom once we have logged it; a bad token is our problem to investigate, not theirs to retry.
    return { status: 200, body: { ResultCode: 0, ResultDesc: 'Logged' } };
  }
}

/** Worker: STK Query for payments whose callback never arrived. */
export async function reconcilePayment(paymentId: string) {
  await withService(async (tx) => {
    const [p] = await tx`select p.*, j.tenant_id from payments p join jobs j on j.id = p.job_id where p.id = ${paymentId} for update`;
    if (!p || !['initiated', 'pending'].includes(p.status) || !p.checkout_request_id) return;
    const { loadTenantById } = await import('@/lib/tenant');
    const tenant = await loadTenantById(p.tenant_id);
    if (!tenant) return;
    const gateway = await mpesaFor(tenant);
    if (isSimulatedMpesa(gateway)) {
      // The simulator never answers by itself: after 10 minutes treat the prompt as timed out.
      if (Date.now() - new Date(p.created_at).getTime() > 10 * 60 * 1000) {
        await tx`select confirm_payment(${p.checkout_request_id}, 1037, 'Timeout (simulator)')`;
      } else {
        await tx`insert into timers (tenant_id, job_id, payment_id, kind, due_at) values (${p.tenant_id}, ${p.job_id}, ${p.id}, 'payment_reconcile', now() + interval '2 minutes')`;
      }
      return;
    }
    const q = await gateway.stkQuery(p.checkout_request_id);
    await tx`update payments set reconcile_attempts = reconcile_attempts + 1 where id = ${p.id}`;
    if (q.resultCode === null) {
      if (Number(p.reconcile_attempts) < 5) {
        await tx`insert into timers (tenant_id, job_id, payment_id, kind, due_at) values (${p.tenant_id}, ${p.job_id}, ${p.id}, 'payment_reconcile', now() + interval '2 minutes')`;
      } else {
        await tx`select confirm_payment(${p.checkout_request_id}, 1037, 'Timeout (no callback, query unresolved)')`;
      }
      return;
    }
    // A successful query does not carry the receipt; the callback (if it ever arrives) is deduped by confirm_payment.
    await tx`select confirm_payment(${p.checkout_request_id}, ${q.resultCode}, ${q.resultDesc}, ${q.resultCode === 0 ? 'STKQUERY-' + p.checkout_request_id.slice(-8) : null}, null, ${tx.json(q.raw as never)})`;
  });
}
