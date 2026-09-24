'use server';

import { revalidatePath } from 'next/cache';
import { requestCtx, requireStaff } from '@/lib/auth';
import { run, type ActionResult } from '@/lib/actions';
import { audit } from '@/lib/audit';
import { safeEqual } from '@/lib/core/crypto';
import { withService, withUser } from '@/lib/db';
import { autoAdvanceAfterHandover, collectionCode, recordHandover, type HandoverPoint } from '@/lib/jobs/logistics';
import { sendQuoteVersion, shopAcceptCounter, shopDeclineCounter, addQuoteMessage } from '@/lib/jobs/quotes';
import {
  cancelJob,
  completeIntake,
  completeRepair,
  counterHandover,
  loadJob,
  postProgress,
  revealPasscode,
  skipZeroDeposit,
  type IntakeInput,
} from '@/lib/jobs/service';
import type { JobRow, QuoteLineInput } from '@/lib/jobs/types';
import { UserError } from '@/lib/jobs/types';

async function staff(min: 'technician' | 'shop_admin' = 'technician') {
  const { session, tenant, role } = await requireStaff(min);
  const ctx = await requestCtx();
  const actor = session.user.is_platform_admin && session.impersonatingTenantId === tenant.id ? 'platform_admin' : role;
  return { session, tenant, role, ctx, userId: session.user.id, actor, impersonatedBy: actor === 'platform_admin' ? session.user.id : null };
}

function done(jobId?: string) {
  if (jobId) revalidatePath(`/bench/jobs/${jobId}`);
  revalidatePath('/bench');
}

// ---------------------------------------------------------------------------
// Handover at the bench: receive from rider (pickup leg) and hand to rider (return leg)
// ---------------------------------------------------------------------------
export async function benchHandoverAction(jobId: string, point: 'rider_to_shop' | 'shop_to_rider', method: 'qr' | 'otp', payload: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      const res = await recordHandover(tx, tenant, job, { point, method, payload, actorUserId: userId });
      if (!res.ok) throw new UserError(res.error === 'invalid' ? 'That code does not belong to the rider assigned to this delivery.' : res.error === 'no_delivery' ? 'No rider is assigned to this job yet.' : 'This handover is not expected right now.');
      if (!job.assigned_tech_id && point === 'rider_to_shop') await tx`update jobs set assigned_tech_id = ${userId} where id = ${jobId}`;
    });
    await autoAdvanceAfterHandover(jobId, point);
    return null;
  });
  done(jobId);
  return r;
}

/** Scanner screen: find which job this rider QR belongs to among jobs expecting a bench handover. */
export async function scanAtBenchAction(payload: string): Promise<ActionResult<{ jobId: string; ref: string; point: HandoverPoint }>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    const found = await withUser(ctx, async (tx) => {
      const candidates = (await tx`select j.* from jobs j where j.tenant_id = ${tenant.id} and j.status in ('picked_up', 'in_transit_to_shop', 'return_requested', 'rider_en_route_to_shop') order by j.updated_at desc limit 50`) as JobRow[];
      // Mock payloads name the delivery; try that job first.
      const hinted = /^RDMOCK:([^:]+):/.exec(payload)?.[1];
      if (hinted) {
        const [d] = await tx`select job_id from deliveries where provider_delivery_id = ${hinted}`;
        if (d) candidates.sort((a) => (a.id === d.job_id ? -1 : 1));
      }
      for (const job of candidates) {
        const point: HandoverPoint = ['picked_up', 'in_transit_to_shop'].includes(job.status) ? 'rider_to_shop' : 'shop_to_rider';
        await tx`savepoint scan`;
        const res = await recordHandover(tx, tenant, job, { point, method: 'qr', payload, actorUserId: userId });
        if (res.ok) {
          if (!job.assigned_tech_id && point === 'rider_to_shop') await tx`update jobs set assigned_tech_id = ${userId} where id = ${job.id}`;
          return { jobId: job.id, ref: job.ref, point };
        }
        await tx`rollback to savepoint scan`;
      }
      throw new UserError('This QR code does not match any rider expected at the shop.');
    });
    await autoAdvanceAfterHandover(found.jobId, found.point);
    return found;
  });
  done();
  return r;
}

// ---------------------------------------------------------------------------
// Assignment, passcode, notes
// ---------------------------------------------------------------------------
export async function assignAction(jobId: string, techId: string | null): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, role, impersonatedBy } = await staff();
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      const target = techId ?? userId;
      if (role !== 'shop_admin' && (target !== userId || (job.assigned_tech_id && job.assigned_tech_id !== userId))) throw new UserError('Only a shop admin can reassign jobs.');
      const [m] = await tx`select 1 from tenant_memberships where tenant_id = ${tenant.id} and user_id = ${target} and active`;
      if (!m) throw new UserError('That person is not active staff.');
      await tx`update jobs set assigned_tech_id = ${target} where id = ${jobId}`;
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'job.assign', entity: 'job', entityId: jobId, diff: { from: job.assigned_tech_id, to: target } });
    });
    return null;
  });
  done(jobId);
  return r;
}

export async function revealPasscodeAction(jobId: string): Promise<ActionResult<{ passcode: string | null }>> {
  return run(async () => {
    const { tenant, ctx, userId } = await staff();
    return withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      if (['closed', 'cancelled', 'declined_returned'].includes(job.status)) throw new UserError('The passcode is deleted once a job closes.');
      // job_secrets RLS already limits this to the assigned technician and shop admins.
      const [visible] = await tx`select 1 from job_secrets where job_id = ${jobId}`;
      if (!visible) throw new UserError('Only the assigned technician or a shop admin can see the passcode.');
      return { passcode: await revealPasscode(tx, tenant, job, userId) };
    });
  });
}

export async function progressAction(jobId: string, input: { template_key?: string | null; body: string; photo_ids?: string[]; internal?: boolean }): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => postProgress(tx, tenant, await loadJob(tx, jobId), input, userId));
    return null;
  });
  done(jobId);
  return r;
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------
export async function completeIntakeAction(jobId: string, input: IntakeInput): Promise<ActionResult<{ discrepancies: number }>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    return withUser(ctx, async (tx) => completeIntake(tx, tenant, await loadJob(tx, jobId), input, userId));
  });
  done(jobId);
  return r;
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------
export async function sendQuoteAction(
  jobId: string,
  input: { kind: 'main' | 'supplementary'; lines: QuoteLineInput[]; turnaroundDays: number | null; message: string; collectUpfront?: boolean },
): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      await sendQuoteVersion(tx, tenant, job, { kind: input.kind, lines: input.lines, turnaroundDays: input.turnaroundDays, message: input.message || null, collectUpfront: input.collectUpfront }, userId);
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, action: `quote.send.${input.kind}`, entity: 'job', entityId: jobId, diff: { lines: input.lines.length } });
    });
    return null;
  });
  done(jobId);
  return r;
}

export async function acceptCounterAction(jobId: string, kind: 'main' | 'supplementary', negotiationId: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => {
      await shopAcceptCounter(tx, tenant, await loadJob(tx, jobId), kind, negotiationId, userId);
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, action: 'quote.accept_counter', entity: 'job', entityId: jobId, diff: { negotiationId } });
    });
    if (kind === 'main') await skipZeroDeposit(jobId);
    return null;
  });
  done(jobId);
  return r;
}

export async function declineCounterAction(jobId: string, kind: 'main' | 'supplementary', message: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => shopDeclineCounter(tx, tenant, await loadJob(tx, jobId), kind, message || null, userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function shopMessageAction(jobId: string, kind: 'main' | 'supplementary', body: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => addQuoteMessage(tx, tenant, await loadJob(tx, jobId), kind, 'shop', body, userId));
    return null;
  });
  done(jobId);
  return r;
}

// ---------------------------------------------------------------------------
// Completion, counter collection, cancellation
// ---------------------------------------------------------------------------
export async function completeRepairAction(jobId: string, input: { tests: Record<string, boolean>; notes: string; photo_ids: string[] }): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    await withUser(ctx, async (tx) => completeRepair(tx, tenant, await loadJob(tx, jobId), input, userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function counterCollectionAction(jobId: string, code: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff();
    const expected = collectionCode(jobId);
    const cleaned = code.trim().replace(/^RDCOLLECT:[^:]+:/, '');
    if (!safeEqual(expected, cleaned)) throw new UserError('That collection code is not right.');
    await withUser(ctx, async (tx) => counterHandover(tx, tenant, await loadJob(tx, jobId), userId));
    return null;
  });
  done(jobId);
  return r;
}

export async function cancelJobAction(jobId: string, reason: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, actor } = await staff('shop_admin');
    if (!reason.trim()) throw new UserError('Give a reason for the cancellation.');
    await withUser(ctx, async (tx) => cancelJob(tx, tenant, await loadJob(tx, jobId), 'shop_admin', reason.trim(), userId));
    void actor;
    return null;
  });
  done(jobId);
  return r;
}

/** Shop admin waives the return fee (e.g. the shop cancelled, or a dispute was resolved in the customer's favour). */
export async function waiveReturnFeeAction(jobId: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff('shop_admin');
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      if (job.status !== 'return_fee_pending') throw new UserError('No return fee is due.');
      await tx`update jobs set return_fee_cents = 0 where id = ${jobId}`;
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, action: 'return_fee.waive', entity: 'job', entityId: jobId, diff: { was: job.return_fee_cents } });
    });
    await withService(async (tx) => {
      const [j] = await tx`select dropoff_choice from jobs where id = ${jobId}`;
      if (j.dropoff_choice && j.dropoff_choice !== 'collect_at_shop') await tx`select transition_job(${jobId}, 'return_requested', 'system', null, ${tx.json({ reason: 'Return fee waived by shop' })})`;
    });
    return null;
  });
  done(jobId);
  return r;
}

export async function resolveDisputeAction(disputeId: string, status: 'resolved' | 'rejected', resolution: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff('shop_admin');
    await withUser(ctx, async (tx) => {
      const [d] = await tx`update disputes set status = ${status}, resolution = ${resolution}, resolved_by = ${userId}, resolved_at = now() where id = ${disputeId} returning job_id`;
      if (!d) throw new UserError('Dispute not found.');
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, action: `dispute.${status}`, entity: 'dispute', entityId: disputeId, diff: { resolution } });
      revalidatePath(`/bench/jobs/${d.job_id}`);
    });
    return null;
  });
  return r;
}

/** Shop admin can edit the dispute/warranty window of a single job (Q-16: "manually set on backend"). */
export async function setWarrantyAction(jobId: string, until: string): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId } = await staff('shop_admin');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new UserError('Pick a date.');
    await withUser(ctx, async (tx) => {
      const job = await loadJob(tx, jobId);
      await tx`update jobs set warranty_until = ${until} where id = ${jobId}`;
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, action: 'job.warranty', entity: 'job', entityId: jobId, diff: { from: job.warranty_until, to: until } });
    });
    return null;
  });
  done(jobId);
  return r;
}
