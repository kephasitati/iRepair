import 'server-only';
import { checkDeviceIdentifier, identifiersMatch, type DeviceType } from '@/lib/core/device-id';
import { withService, type Tx } from '@/lib/db';
import { encryptForTenant, decryptForTenant } from '@/lib/tenant-crypto';
import type { Tenant } from '@/lib/tenant';
import type { Address } from '@/lib/providers/delivery/types';
import { audit } from '@/lib/audit';
import { quoteLeg } from './logistics';
import { upsertProforma } from './invoices';
import type { DeclaredCondition, JobRow } from './types';
import { UserError } from './types';

/** Booking wizard, intake, repair progress, completion, drop-off and closing. All in the caller's RLS transaction. */

export async function loadJob(tx: Tx, jobId: string): Promise<JobRow> {
  const [j] = (await tx`select * from jobs where id = ${jobId}`) as JobRow[];
  if (!j) throw new UserError('Job not found.');
  for (const k of ['declared_value_cents', 'consultation_fee_cents', 'pickup_fee_cents', 'return_fee_cents'] as const) j[k] = Number(j[k]);
  return j;
}

// ---------------------------------------------------------------------------
// Draft / wizard
// ---------------------------------------------------------------------------
export type DraftInput = {
  device_type: DeviceType;
  device_brand?: string;
  device_model: string;
  device_colour?: string | null;
  device_storage?: string | null;
  fault_description: string;
  declared_condition: DeclaredCondition;
  accessories: string[];
  passcode_locked: boolean;
  passcode_shared: boolean;
  passcode?: string | null;
  identifier: string;
  declared_value_cents: number;
  save_device?: boolean;
};

export async function createOrUpdateDraft(tx: Tx, tenant: Tenant, userId: string, input: DraftInput, jobId?: string | null): Promise<string> {
  const id = checkDeviceIdentifier(input.device_type, input.identifier);
  if (!id.ok) throw new UserError(`identifier:${id.error}`);
  if (!input.device_model.trim()) throw new UserError('Enter the device model.');
  if (input.fault_description.trim().length < 5) throw new UserError('Describe the fault in a few words.');
  if (input.passcode_locked && input.passcode_shared && !input.passcode) throw new UserError('Enter the passcode or choose not to share it.');

  let job: JobRow;
  if (jobId) {
    job = await loadJob(tx, jobId);
    if (job.status !== 'draft') throw new UserError('This booking can no longer be edited.');
    await tx`update jobs set device_type = ${input.device_type}, device_brand = ${input.device_brand ?? ''}, device_model = ${input.device_model.trim()},
      device_colour = ${input.device_colour ?? null}, device_storage = ${input.device_storage ?? null}, fault_description = ${input.fault_description.trim()},
      declared_condition = ${tx.json(input.declared_condition as never)}, accessories = ${input.accessories}, passcode_locked = ${input.passcode_locked},
      passcode_shared = ${input.passcode_locked && input.passcode_shared}, declared_value_cents = ${input.declared_value_cents} where id = ${jobId}`;
  } else {
    const [{ ref }] = await tx`select next_job_ref(${tenant.id}) as ref`;
    [job] = (await tx`insert into jobs (tenant_id, ref, customer_user_id, device_type, device_brand, device_model, device_colour, device_storage, fault_description,
        declared_condition, accessories, passcode_locked, passcode_shared, declared_value_cents, consultation_fee_cents)
      values (${tenant.id}, ${ref}, ${userId}, ${input.device_type}, ${input.device_brand ?? ''}, ${input.device_model.trim()}, ${input.device_colour ?? null}, ${input.device_storage ?? null},
        ${input.fault_description.trim()}, ${tx.json(input.declared_condition as never)}, ${input.accessories}, ${input.passcode_locked}, ${input.passcode_locked && input.passcode_shared},
        ${input.declared_value_cents}, ${tenant.settings.consultation_fee_cents}) returning *`) as JobRow[];
  }

  const passcodeEnc = input.passcode_locked && input.passcode_shared && input.passcode ? await encryptForTenant(tenant.id, input.passcode, `passcode:${job.id}`, tx) : null;
  await tx`insert into job_secrets (job_id, tenant_id, identifier, identifier_kind, passcode_enc, passcode_key_version)
    values (${job.id}, ${tenant.id}, ${id.normalized}, ${id.kind}, ${passcodeEnc?.ciphertext ?? null}, ${passcodeEnc?.version ?? null})
    on conflict (job_id) do update set identifier = excluded.identifier, identifier_kind = excluded.identifier_kind,
      passcode_enc = coalesce(excluded.passcode_enc, case when ${input.passcode_locked && input.passcode_shared} then job_secrets.passcode_enc else null end),
      passcode_key_version = case when excluded.passcode_enc is null and not ${input.passcode_locked && input.passcode_shared} then null else coalesce(excluded.passcode_key_version, job_secrets.passcode_key_version) end`;

  if (input.save_device) {
    const [d] = await tx`insert into devices (user_id, type, brand, model, colour, storage, identifier, identifier_kind)
      values (${userId}, ${input.device_type}, ${input.device_brand ?? ''}, ${input.device_model.trim()}, ${input.device_colour ?? null}, ${input.device_storage ?? null}, ${id.normalized}, ${id.kind}) returning id`;
    await tx`update jobs set device_id = ${d.id} where id = ${job.id}`;
  }
  return job.id;
}

export async function setPickup(tx: Tx, tenant: Tenant, userId: string, jobId: string, input: { address: Address; save_address?: boolean; label?: string; window_start: Date; window_end: Date }) {
  const job = await loadJob(tx, jobId);
  if (job.status !== 'draft') throw new UserError('This booking can no longer be edited.');
  if (!input.address.formatted?.trim()) throw new UserError('Enter the pickup address.');
  if (tenant.settings.service_zones.length && input.address.zone && !tenant.settings.service_zones.map((z) => z.toLowerCase()).includes(input.address.zone.toLowerCase())) {
    throw new UserError(`zone:${tenant.settings.service_zones.join(', ')}`);
  }
  if (input.window_start.getTime() < Date.now()) throw new UserError('Choose a pickup time in the future.');
  if (input.save_address) {
    await tx`insert into addresses (user_id, label, formatted, place_id, lat, lng, landmark, building_floor, zone)
      values (${userId}, ${input.label ?? ''}, ${input.address.formatted}, ${input.address.place_id ?? null}, ${input.address.lat ?? null}, ${input.address.lng ?? null}, ${input.address.landmark ?? null}, ${input.address.building_floor ?? null}, ${input.address.zone ?? null})`;
  }
  await tx`update jobs set pickup_address = ${tx.json(input.address as never)}, pickup_window_start = ${input.window_start}, pickup_window_end = ${input.window_end} where id = ${jobId}`;
  const fresh = await loadJob(tx, jobId);
  const q = await quoteLeg(tx, tenant, fresh, 'pickup');
  await tx`update jobs set pickup_fee_cents = ${q.chargedCents + fresh.consultation_fee_cents} where id = ${jobId}`;
  return { deliveryFeeCents: q.chargedCents, consultationCents: fresh.consultation_fee_cents, totalCents: q.chargedCents + fresh.consultation_fee_cents };
}

export async function submitDraft(tx: Tx, jobId: string, userId: string) {
  await tx`select transition_job(${jobId}, 'pickup_fee_pending', 'customer', ${userId}, '{}')`;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------
export async function recordPhoto(tx: Tx, tenant: Tenant, jobId: string, input: { stage: string; kind: string; storage_key: string; content_type?: string; bytes?: number; width?: number; height?: number; taken_at?: Date | null; client_upload_id?: string | null; uploaded_by: string }) {
  const [p] = await tx`insert into job_photos (job_id, tenant_id, stage, kind, storage_key, content_type, bytes, width, height, taken_at, uploaded_by, client_upload_id)
    values (${jobId}, ${tenant.id}, ${input.stage}, ${input.kind}, ${input.storage_key}, ${input.content_type ?? 'image/jpeg'}, ${input.bytes ?? null}, ${input.width ?? null}, ${input.height ?? null}, ${input.taken_at ?? null}, ${input.uploaded_by}, ${input.client_upload_id ?? null})
    on conflict (job_id, client_upload_id) do update set storage_key = job_photos.storage_key returning id`;
  return p.id as string;
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------
export type IntakeInput = {
  identifier_read: string;
  accessories_received: string[];
  condition_checks: Record<string, boolean | string>;
  powers_on: boolean;
  summary: string;
  discrepancies: { field: string; declared_value?: string | null; observed_value?: string | null; note?: string | null; photo_ids?: string[] }[];
};

export async function completeIntake(tx: Tx, tenant: Tenant, job: JobRow, input: IntakeInput, actorUserId: string) {
  if (job.status !== 'received_at_shop') throw new UserError('Intake can only be completed once the device has been received.');
  const [sec] = await tx`select identifier from job_secrets where job_id = ${job.id}`;
  const matches = identifiersMatch(sec?.identifier, input.identifier_read);
  const discrepancies = [...input.discrepancies];
  if (!matches && input.identifier_read.trim()) {
    discrepancies.push({ field: 'identifier', declared_value: sec?.identifier ?? '', observed_value: input.identifier_read.trim().toUpperCase(), note: 'IMEI/serial read at the bench does not match the declaration' });
  }
  if (!input.summary.trim()) throw new UserError('Write a short intake summary for the customer.');
  await tx`insert into intake_checklists (job_id, tenant_id, identifier_read, identifier_matches, accessories_received, condition_checks, powers_on, summary, completed_by)
    values (${job.id}, ${tenant.id}, ${input.identifier_read.trim().toUpperCase()}, ${matches}, ${input.accessories_received}, ${tx.json(input.condition_checks as never)}, ${input.powers_on}, ${input.summary.trim()}, ${actorUserId})`;
  for (const d of discrepancies) {
    await tx`insert into discrepancies (job_id, tenant_id, field, declared_value, observed_value, note, photo_ids)
      values (${job.id}, ${tenant.id}, ${d.field}, ${d.declared_value ?? null}, ${d.observed_value ?? null}, ${d.note ?? null}, ${d.photo_ids ?? []})`;
  }
  await audit(tx, { tenantId: tenant.id, actorUserId, action: 'intake.complete', entity: 'job', entityId: job.id, diff: { matches, discrepancies: discrepancies.length } });
  const to = discrepancies.length ? 'intake_ack_pending' : 'diagnosing';
  await tx`select transition_job(${job.id}, ${to}::job_status, 'technician', ${actorUserId}, '{}')`;
  await tx`select notify_job(${job.id}, 'intake.summary', ${tx.json({ reason: input.summary.trim().slice(0, 300) } as never)})`;
  return { discrepancies: discrepancies.length };
}

export async function acknowledgeDiscrepancies(tx: Tx, job: JobRow, userId: string) {
  if (job.status !== 'intake_ack_pending') throw new UserError('Nothing to acknowledge.');
  await tx`update discrepancies set acknowledged_at = now() where job_id = ${job.id} and acknowledged_at is null`;
  await tx`select transition_job(${job.id}, 'diagnosing', 'customer', ${userId}, '{}')`;
}

export async function revealPasscode(tx: Tx, tenant: Tenant, job: JobRow, actorUserId: string): Promise<string | null> {
  const [sec] = await tx`select passcode_enc from job_secrets where job_id = ${job.id}`;
  if (!sec?.passcode_enc) return null;
  await audit(tx, { tenantId: tenant.id, actorUserId, action: 'passcode.reveal', entity: 'job', entityId: job.id });
  return decryptForTenant(tenant.id, sec.passcode_enc, `passcode:${job.id}`, tx);
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------
export async function postProgress(tx: Tx, tenant: Tenant, job: JobRow, input: { template_key?: string | null; body: string; photo_ids?: string[]; internal?: boolean }, actorUserId: string) {
  if (!input.body.trim()) throw new UserError('Write an update.');
  await tx`insert into job_progress_updates (job_id, tenant_id, template_key, body, photo_ids, internal, created_by)
    values (${job.id}, ${tenant.id}, ${input.template_key ?? null}, ${input.body.trim()}, ${input.photo_ids ?? []}, ${input.internal ?? false}, ${actorUserId})`;
  await tx`insert into job_events (job_id, tenant_id, event_kind, actor_kind, actor_user_id, payload) values (${job.id}, ${tenant.id}, ${input.internal ? 'note.internal' : 'progress.update'}, 'technician', ${actorUserId}, ${tx.json({ body: input.body.trim().slice(0, 200) } as never)})`;
  if (!input.internal) await tx`select notify_job(${job.id}, 'progress.update', ${tx.json({ reason: input.body.trim().slice(0, 300) } as never)})`;
}

export async function completeRepair(tx: Tx, tenant: Tenant, job: JobRow, input: { tests: Record<string, boolean>; notes?: string; photo_ids: string[] }, actorUserId: string) {
  if (!input.photo_ids.length) throw new UserError('Add at least one "after" photo.');
  const failed = Object.entries(input.tests).filter(([, v]) => !v).map(([k]) => k);
  if (failed.length && !input.notes?.trim()) throw new UserError('Explain the tests that did not pass.');
  await tx`insert into completion_checklists (job_id, tenant_id, tests, notes, completed_by) values (${job.id}, ${tenant.id}, ${tx.json(input.tests as never)}, ${input.notes ?? ''}, ${actorUserId})
    on conflict (job_id) do update set tests = excluded.tests, notes = excluded.notes, completed_by = excluded.completed_by, completed_at = now()`;
  await audit(tx, { tenantId: tenant.id, actorUserId, action: 'repair.complete', entity: 'job', entityId: job.id, diff: { failed } });
  await tx`select transition_job(${job.id}, 'repair_complete', 'technician', ${actorUserId}, '{}')`;
}

// ---------------------------------------------------------------------------
// Drop-off and final invoice
// ---------------------------------------------------------------------------
export type DropoffInput = { choice: 'pickup_address' | 'other_address' | 'collect_at_shop'; address?: Address | null; window_start?: Date | null; window_end?: Date | null };

/**
 * Customer chooses how to get the device back. Quotes the return leg (unless collecting), builds the proforma
 * and moves to final_payment_pending. If nothing is owed the job dispatches immediately.
 */
export async function chooseDropoff(tx: Tx, tenant: Tenant, job: JobRow, input: DropoffInput, userId: string) {
  if (!['repair_complete', 'final_payment_pending', 'return_fee_pending', 'return_failed'].includes(job.status)) throw new UserError('Drop-off cannot be changed right now.');
  if (input.choice === 'other_address' && !input.address?.formatted) throw new UserError('Enter the delivery address.');
  await tx`update jobs set dropoff_choice = ${input.choice}, dropoff_address = ${input.choice === 'other_address' ? tx.json(input.address as never) : input.choice === 'pickup_address' ? tx.json(job.pickup_address as never) : null},
    dropoff_window_start = ${input.window_start ?? null}, dropoff_window_end = ${input.window_end ?? null} where id = ${job.id}`;
  let fresh = await loadJob(tx, job.id);
  let returnFee = 0;
  if (input.choice !== 'collect_at_shop') {
    const q = await quoteLeg(tx, tenant, fresh, 'return');
    returnFee = q.chargedCents;
  } else {
    await tx`update deliveries set status = 'cancelled' where job_id = ${job.id} and leg = 'return' and status = 'quoted'`;
  }
  await tx`update jobs set return_fee_cents = ${returnFee} where id = ${job.id}`;
  fresh = await loadJob(tx, job.id);

  if (fresh.status === 'return_fee_pending' || fresh.status === 'return_failed') {
    // Declined / cancelled path: only the return fee is payable (or nothing, when collecting).
    if (input.choice === 'collect_at_shop') await tx`select transition_job(${job.id}, 'ready_for_collection', 'customer', ${userId}, '{}')`;
    else if (fresh.status === 'return_failed') await tx`select transition_job(${job.id}, 'return_requested', 'customer', ${userId}, '{}')`;
    return { returnFeeCents: returnFee, balanceCents: returnFee };
  }

  const invoiceId = await upsertProforma(tx, tenant, fresh, 'repaired');
  const [inv] = await tx`select balance_cents from invoices where id = ${invoiceId}`;
  if (fresh.status === 'repair_complete') await tx`select transition_job(${job.id}, 'final_payment_pending', 'customer', ${userId}, '{}')`;
  return { returnFeeCents: returnFee, balanceCents: Number(inv.balance_cents), invoiceId };
}

/** Zero-balance invoices need no M-Pesa: issue and dispatch as the system. */
export async function settleZeroBalance(jobId: string) {
  await withService(async (tx) => {
    const [job] = (await tx`select * from jobs where id = ${jobId}`) as JobRow[];
    const [inv] = await tx`select id, balance_cents, total_cents from invoices where job_id = ${jobId} and status = 'proforma'`;
    if (!job || job.status !== 'final_payment_pending' || !inv || Number(inv.balance_cents) > 0) return;
    await tx`update invoices set status = 'issued', number = coalesce(number, next_invoice_number(${job.tenant_id})), issued_at = now() where id = ${inv.id}`;
    await tx`insert into outbox (tenant_id, kind, payload, dedupe_key) values (${job.tenant_id}, 'invoice.pdf', ${tx.json({ invoice_id: inv.id })}, ${'invoice.pdf:' + inv.id}) on conflict do nothing`;
    await tx`select transition_job(${jobId}, 'dispatch_pending', 'system', null, '{}')`;
  });
}

/** Zero deposit (tenant rule) skips the payment step. */
export async function skipZeroDeposit(jobId: string) {
  await withService(async (tx) => {
    const [job] = (await tx`select status from jobs where id = ${jobId}`) as Pick<JobRow, 'status'>[];
    const [v] = await tx`select v.deposit_cents from quotes q join quote_versions v on v.id = q.accepted_version_id where q.job_id = ${jobId} and q.kind = 'main'`;
    if (job?.status === 'deposit_pending' && Number(v?.deposit_cents ?? 0) === 0) await tx`select transition_job(${jobId}, 'in_repair', 'system', null, '{}')`;
  });
}

/** Declined/cancelled path with nothing to pay for the return (fee 0). */
export async function settleZeroReturnFee(jobId: string) {
  await withService(async (tx) => {
    const [job] = (await tx`select status, return_fee_cents, dropoff_choice from jobs where id = ${jobId}`) as Pick<JobRow, 'status' | 'return_fee_cents' | 'dropoff_choice'>[];
    if (job?.status === 'return_fee_pending' && Number(job.return_fee_cents) === 0 && job.dropoff_choice && job.dropoff_choice !== 'collect_at_shop') {
      await tx`select transition_job(${jobId}, 'return_requested', 'system', null, '{}')`;
    }
  });
}

// ---------------------------------------------------------------------------
// Closing
// ---------------------------------------------------------------------------
export function terminalFor(outcome: JobRow['outcome']): 'closed' | 'declined_returned' | 'cancelled' {
  return outcome === 'repaired' ? 'closed' : outcome === 'declined' ? 'declined_returned' : 'cancelled';
}

export async function confirmDeliveredAndRate(tx: Tx, tenant: Tenant, job: JobRow, input: { score?: number | null; comment?: string | null; notAsExpected?: boolean; issue?: string | null }, userId: string) {
  if (job.status !== 'delivered') throw new UserError('The device has not been delivered yet.');
  if (input.score) {
    await tx`insert into ratings (job_id, tenant_id, score, comment) values (${job.id}, ${tenant.id}, ${input.score}, ${input.comment ?? null}) on conflict (job_id) do update set score = excluded.score, comment = excluded.comment`;
  }
  if (input.notAsExpected) {
    await tx`update jobs set not_as_expected = true where id = ${job.id}`;
    await tx`insert into disputes (job_id, tenant_id, kind, body, opened_by) values (${job.id}, ${tenant.id}, 'delivery', ${input.issue ?? 'Customer reports the device is not as expected'}, ${userId})`;
    await tx`select notify_job(${job.id}, 'alert.not_as_expected', ${tx.json({ reason: (input.issue ?? '').slice(0, 300) } as never)})`;
  }
  await tx`select transition_job(${job.id}, ${terminalFor(job.outcome)}::job_status, 'customer', ${userId}, '{}')`;
}

export async function counterHandover(tx: Tx, tenant: Tenant, job: JobRow, actorUserId: string) {
  if (job.status !== 'ready_for_collection') throw new UserError('This job is not waiting for collection.');
  await tx`insert into handover_events (job_id, tenant_id, point, method, actor_user_id, verified) values (${job.id}, ${tenant.id}, 'counter_collection', 'otp', ${actorUserId}, true)`;
  await tx`select transition_job(${job.id}, ${terminalFor(job.outcome)}::job_status, 'technician', ${actorUserId}, '{}')`;
}

export async function cancelJob(tx: Tx, tenant: Tenant, job: JobRow, actor: 'customer' | 'shop_admin', reason: string, actorUserId: string) {
  if (actor === 'shop_admin') {
    const atShop = ['received_at_shop', 'intake_ack_pending', 'diagnosing', 'quote_sent', 'quote_negotiating', 'quote_expired', 'deposit_pending', 'in_repair', 'repair_complete', 'final_payment_pending'].includes(job.status);
    await audit(tx, { tenantId: tenant.id, actorUserId, action: 'job.cancel', entity: 'job', entityId: job.id, diff: { reason, status: job.status } });
    if (atShop) {
      await tx`select transition_job(${job.id}, 'return_fee_pending', 'shop_admin', ${actorUserId}, ${tx.json({ reason, outcome: 'cancelled' } as never)})`;
      return;
    }
  }
  await tx`select transition_job(${job.id}, 'cancelled', ${actor}::actor_kind, ${actorUserId}, ${tx.json({ reason } as never)})`;
}

export async function openDispute(tx: Tx, tenant: Tenant, job: JobRow, kind: 'intake' | 'warranty' | 'delivery', body: string, userId: string) {
  if (!body.trim()) throw new UserError('Describe the problem.');
  if (kind === 'warranty' && (!job.warranty_until || new Date(job.warranty_until) < new Date())) throw new UserError('The warranty period for this repair has ended.');
  await tx`insert into disputes (job_id, tenant_id, kind, body, opened_by) values (${job.id}, ${tenant.id}, ${kind}, ${body.trim()}, ${userId})`;
  await tx`select notify_job(${job.id}, 'dispute.opened', ${tx.json({ reason: body.trim().slice(0, 300) } as never)})`;
}
