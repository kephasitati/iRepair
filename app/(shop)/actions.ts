'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requestCtx, requireCustomer } from '@/lib/auth';
import { run, type ActionResult } from '@/lib/actions';
import { normalizeKenyanPhone } from '@/lib/core/phone';
import { withUser } from '@/lib/db';
import { autoAdvanceAfterHandover, recordHandover, type HandoverPoint } from '@/lib/jobs/logistics';
import { initiateStkPayment } from '@/lib/jobs/payments';
import { addQuoteMessage, customerAccept, customerCounter, customerDecline } from '@/lib/jobs/quotes';
import {
  acknowledgeDiscrepancies,
  cancelJob,
  chooseDropoff,
  confirmDeliveredAndRate,
  createOrUpdateDraft,
  loadJob,
  openDispute,
  setPickup,
  settleZeroBalance,
  settleZeroReturnFee,
  skipZeroDeposit,
  submitDraft,
  type DraftInput,
  type DropoffInput,
} from '@/lib/jobs/service';
import type { PaymentPurpose } from '@/lib/jobs/types';
import { UserError } from '@/lib/jobs/types';
import type { Address } from '@/lib/providers/delivery/types';

async function customer() {
  const { session, tenant } = await requireCustomer();
  const ctx = await requestCtx();
  return { session, tenant, ctx, userId: session.user.id };
}

function done(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
}

// ---------------------------------------------------------------------------
// Booking wizard
// ---------------------------------------------------------------------------
export async function saveDraftAction(jobId: string | null, input: DraftInput): Promise<ActionResult<{ jobId: string }>> {
  return run(async () => {
    const { tenant, ctx, userId } = await customer();
    const id = await withUser(ctx, (tx) => createOrUpdateDraft(tx, tenant, userId, input, jobId));
    return { jobId: id };
  });
}

export async function setPickupAction(
  jobId: string,
  input: { address: Address; saveAddress: boolean; label?: string; windowStart: string; windowEnd: string },
): Promise<ActionResult<{ deliveryFeeCents: number; consultationCents: number; totalCents: number }>> {
  return run(async () => {
    const { tenant, ctx, userId } = await customer();
    return withUser(ctx, (tx) =>
      setPickup(tx, tenant, userId, jobId, { address: input.address, save_address: input.saveAddress, label: input.label, window_start: new Date(input.windowStart), window_end: new Date(input.windowEnd) }),
    );
  });
}

export async function submitDraftAction(jobId: string): Promise<ActionResult<null>> {
  const res = await run(async () => {
    const { ctx, userId } = await customer();
    await withUser(ctx, (tx) => submitDraft(tx, jobId, userId));
    return null;
  });
  if (res.ok) redirect(`/jobs/${jobId}?pay=1`);
  return res;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export async function startPaymentAction(
  jobId: string,
  purpose: PaymentPurpose,
  phoneRaw: string,
  quoteId?: string | null,
): Promise<ActionResult<{ paymentId: string; simulated: boolean; message: string }>> {
  return run(async () => {
    const { tenant, ctx } = await customer();
    const phone = normalizeKenyanPhone(phoneRaw);
    if (!phone) throw new UserError('Enter a valid Safaricom number.');
    const r = await initiateStkPayment(ctx, tenant, jobId, purpose, phone, quoteId);
    if (!r.ok) throw new UserError(r.error === 'rate_limited' ? 'Too many payment prompts. Please wait a minute.' : `M-Pesa did not accept the request: ${r.error}`);
    return { paymentId: r.paymentId, simulated: r.simulated, message: r.customerMessage };
  });
}

// ---------------------------------------------------------------------------
// Handover (customer scans the rider's QR at the door / on delivery)
// ---------------------------------------------------------------------------
export async function customerHandoverAction(
  jobId: string,
  input: { method: 'qr' | 'otp'; payload: string; geo?: { lat: number; lng: number; accuracy?: number } | null },
): Promise<ActionResult<{ rider: { name: string; phone: string; plate?: string | null } | null }>> {
  const res = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    return withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      const point: HandoverPoint = ['rider_en_route_to_customer', 'pickup_requested'].includes(job.status) ? 'customer_to_rider' : 'rider_to_customer';
      const photoIds = point === 'customer_to_rider' ? (await tx`select id from job_photos where job_id = ${jobId} and stage = 'customer_declared' and deleted_at is null`).map((r) => r.id as string) : [];
      const r = await recordHandover(tx, tenant, job, { point, method: input.method, payload: input.payload, actorUserId: userId, geo: input.geo, photoIds });
      if (!r.ok) {
        throw new UserError(
          r.error === 'invalid' ? 'That code does not belong to the rider assigned to this delivery.' : r.error === 'no_delivery' ? 'No rider has been assigned yet.' : 'This handover is not expected right now.',
        );
      }
      return { rider: r.rider, point };
    });
  });
  if (res.ok) {
    await autoAdvanceAfterHandover(jobId, res.data.point);
    done(jobId);
    return { ok: true, data: { rider: res.data.rider } };
  }
  return res;
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------
export async function acknowledgeIntakeAction(jobId: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { ctx, userId } = await customer();
    await withUser(ctx, async (tx) => acknowledgeDiscrepancies(tx, await loadJob(tx, jobId), userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function rejectIntakeAction(jobId: string, reason: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      if (job.status !== 'intake_ack_pending') throw new UserError('Nothing to reject.');
      await openDispute(tx, tenant, job, 'intake', reason || 'Customer disputes the intake report', userId);
      await tx`select transition_job(${jobId}, 'return_fee_pending', 'customer', ${userId}, ${tx.json({ outcome: 'cancelled', reason: 'Customer rejected the intake report' })})`;
    });
    return null;
  });
  done(jobId);
  return r;
}

// ---------------------------------------------------------------------------
// Quote and negotiation
// ---------------------------------------------------------------------------
export async function acceptQuoteAction(jobId: string, kind: 'main' | 'supplementary'): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => customerAccept(tx, tenant, await loadJob(tx, jobId), kind, userId));
    if (kind === 'main') await skipZeroDeposit(jobId);
    return null;
  });
  done(jobId);
  return r;
}

export async function declineQuoteAction(jobId: string, kind: 'main' | 'supplementary'): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => customerDecline(tx, tenant, await loadJob(tx, jobId), kind, userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function counterQuoteAction(jobId: string, kind: 'main' | 'supplementary', amountKes: number, message: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => customerCounter(tx, tenant, await loadJob(tx, jobId), kind, Math.round(amountKes) * 100, message || null, userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function quoteMessageAction(jobId: string, kind: 'main' | 'supplementary', body: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => addQuoteMessage(tx, tenant, await loadJob(tx, jobId), kind, 'customer', body, userId));
    return null;
  });
  done(jobId);
  return r;
}

// ---------------------------------------------------------------------------
// Drop-off, delivery confirmation, rating, cancellation, disputes
// ---------------------------------------------------------------------------
export async function chooseDropoffAction(jobId: string, input: { choice: DropoffInput['choice']; address?: Address | null; windowStart?: string | null; windowEnd?: string | null }): Promise<ActionResult<{ balanceCents: number }>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    const res = await withUser(ctx, async (tx) =>
      chooseDropoff(tx, tenant, await loadJob(tx, jobId), { choice: input.choice, address: input.address, window_start: input.windowStart ? new Date(input.windowStart) : null, window_end: input.windowEnd ? new Date(input.windowEnd) : null }, userId),
    );
    if (res.balanceCents <= 0) {
      await settleZeroBalance(jobId);
      await settleZeroReturnFee(jobId);
    }
    return { balanceCents: res.balanceCents };
  });
  done(jobId);
  return r;
}

export async function confirmDeliveredAction(jobId: string, input: { score: number | null; comment: string; notAsExpected: boolean; issue: string }): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => confirmDeliveredAndRate(tx, tenant, await loadJob(tx, jobId), { score: input.score, comment: input.comment || null, notAsExpected: input.notAsExpected, issue: input.issue || null }, userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function rateJobAction(jobId: string, score: number, comment: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx } = await customer();
    if (score < 1 || score > 5) throw new UserError('Choose 1 to 5 stars.');
    await withUser(ctx, (tx) => tx`insert into ratings (job_id, tenant_id, score, comment) values (${jobId}, ${tenant.id}, ${score}, ${comment || null}) on conflict (job_id) do nothing`);
    return null;
  });
  done(jobId);
  return r;
}

export async function cancelBookingAction(jobId: string, reason: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      if (['draft', 'pickup_fee_pending', 'pickup_requested', 'rider_en_route_to_customer', 'pickup_failed'].includes(job.status)) {
        await cancelJob(tx, tenant, job, 'customer', reason || 'Cancelled by customer', userId);
      } else if (['diagnosing', 'intake_ack_pending'].includes(job.status)) {
        await tx`select transition_job(${jobId}, 'return_fee_pending', 'customer', ${userId}, ${tx.json({ outcome: 'cancelled', reason: reason || 'Cancelled by customer' })})`;
      } else {
        throw new UserError('This job can no longer be cancelled from the app. Please contact the shop.');
      }
    });
    return null;
  });
  done(jobId);
  return r;
}

export async function rebookPickupAction(jobId: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { ctx, userId } = await customer();
    await withUser(ctx, (tx) => tx`select transition_job(${jobId}, 'pickup_requested', 'customer', ${userId}, '{}')`);
    return null;
  });
  done(jobId);
  return r;
}

export async function disputeAction(jobId: string, body: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await customer();
    await withUser(ctx, async (tx) => openDispute(tx, tenant, await loadJob(tx, jobId), 'warranty', body, userId));
    return null;
  });
  done(jobId);
  return r;
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------
export async function deleteAddressAction(id: string) {
  const { ctx } = await customer();
  await withUser(ctx, (tx) => tx`delete from addresses where id = ${id}`);
  revalidatePath('/account');
}

export async function deleteDeviceAction(id: string) {
  const { ctx } = await customer();
  await withUser(ctx, (tx) => tx`delete from devices where id = ${id}`);
  revalidatePath('/account');
}

export async function updateNameAction(fd: FormData) {
  const { ctx, userId } = await customer();
  const name = String(fd.get('name') ?? '').trim().slice(0, 100);
  const email = String(fd.get('email') ?? '').trim().toLowerCase().slice(0, 200) || null;
  await withUser(ctx, (tx) => tx`update users set full_name = ${name}, email = ${email} where id = ${userId}`);
  revalidatePath('/account');
}
