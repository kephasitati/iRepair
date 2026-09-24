import 'server-only';
import { deliveryCharge, kesToCents } from '@/lib/core/money';
import { hmacSha256 } from '@/lib/core/crypto';
import type { ActorKind, JobStatus } from '@/lib/core/state-machine';
import { withService, type Tx } from '@/lib/db';
import { env } from '@/lib/env';
import { deliveryProviderFor } from '@/lib/providers';
import type { Address, DeliveryStatusValue, Rider } from '@/lib/providers/delivery/types';
import { loadTenantById, type Tenant } from '@/lib/tenant';
import type { DeliveryRow, JobRow } from './types';

/** Courier legs: quoting, booking, status sync and handover verification. Shared by server actions, worker and webhooks. */

export function shopAddress(tenant: Tenant): Address {
  return { formatted: tenant.settings.address_formatted, lat: tenant.settings.address_lat, lng: tenant.settings.address_lng, landmark: tenant.settings.address_landmark };
}

export function customerAddressFor(job: JobRow, leg: 'pickup' | 'return'): Address {
  if (leg === 'pickup') return job.pickup_address!;
  return job.dropoff_choice === 'other_address' && job.dropoff_address ? job.dropoff_address : job.pickup_address!;
}

/**
 * Get a courier quote for a leg and store it as a `quoted` deliveries row (superseding earlier quotes for that leg).
 * Returns the fee the customer is charged (cost + markup, whole shillings).
 *
 * Delivery rows are system-owned (customers may read but not write them), so the write runs in its own service
 * transaction. Callers must already have proven access to `job` in their own RLS-scoped transaction.
 */
export async function quoteLeg(tenant: Tenant, job: JobRow, leg: 'pickup' | 'return'): Promise<{ chargedCents: number; costCents: number; deliveryId: string }> {
  const provider = await deliveryProviderFor(tenant);
  const from = leg === 'pickup' ? customerAddressFor(job, 'pickup') : shopAddress(tenant);
  const to = leg === 'pickup' ? shopAddress(tenant) : customerAddressFor(job, 'return');
  const scheduledFor = leg === 'pickup' ? job.pickup_window_start : job.dropoff_window_start;
  const q = await provider.quote({ pickup: from, dropoff: to, itemValueKes: job.declared_value_cents / 100, scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined });
  const costCents = kesToCents(q.feeKes);
  const { charged } = deliveryCharge(costCents, tenant.settings.delivery_markup_bp);
  return withService(async (tx) => {
    await tx`update deliveries set status = 'cancelled' where job_id = ${job.id} and leg = ${leg} and status = 'quoted'`;
    const [{ attempt }] = await tx`select coalesce(max(attempt), 0) + 1 as attempt from deliveries where job_id = ${job.id} and leg = ${leg} and status <> 'quoted'`;
    const [d] = await tx`insert into deliveries (job_id, tenant_id, leg, attempt, provider, quote_ref, fee_cost_cents, fee_charged_cents, status, pickup_address, dropoff_address, scheduled_for)
      values (${job.id}, ${tenant.id}, ${leg}, ${attempt}, ${provider.kind}, ${q.quoteRef}, ${costCents}, ${charged}, 'quoted', ${tx.json(from as never)}, ${tx.json(to as never)}, ${scheduledFor})
      returning id`;
    return { chargedCents: charged, costCents, deliveryId: d.id as string };
  });
}

/** Worker: outbox `delivery.create`. Books the courier for the latest quoted row of the leg (re-quoting if none). */
export async function bookLeg(jobId: string, leg: 'pickup' | 'return') {
  await withService(async (tx) => {
    const [job] = (await tx`select * from jobs where id = ${jobId} for update`) as JobRow[];
    if (!job) return;
    const expected: JobStatus[] = leg === 'pickup' ? ['pickup_requested'] : ['return_requested'];
    if (!expected.includes(job.status)) return; // job moved on (cancelled etc.) before we got here
    const tenant = await loadTenantById(job.tenant_id);
    if (!tenant) throw new Error(`tenant ${job.tenant_id} not found`);
    let [d] = (await tx`select * from deliveries where job_id = ${jobId} and leg = ${leg} and status = 'quoted' order by created_at desc limit 1`) as DeliveryRow[];
    if (!d) {
      const q = await quoteLeg(tenant, job, leg);
      [d] = (await tx`select * from deliveries where id = ${q.deliveryId}`) as DeliveryRow[];
    }
    const [customer] = await tx`select phone_e164 from users where id = ${job.customer_user_id}`;
    const provider = await deliveryProviderFor(tenant);
    const idempotencyKey = `${job.id}:${leg}:${d.attempt}`;
    const res = await provider.create({
      quoteRef: d.quote_ref ?? '',
      jobRef: job.ref,
      description: `${job.device_brand} ${job.device_model}`.trim() + (leg === 'pickup' ? ' for repair' : ' (repaired)'),
      senderPhone: leg === 'pickup' ? customer.phone_e164 : tenant.settings.contact_phone,
      recipientPhone: leg === 'pickup' ? tenant.settings.contact_phone : customer.phone_e164,
      pickup: d.pickup_address,
      dropoff: d.dropoff_address,
      itemValueKes: job.declared_value_cents / 100,
      instructions: [d.pickup_address.landmark, d.pickup_address.building_floor].filter(Boolean).join('. ') || undefined,
      scheduledFor: d.scheduled_for ? new Date(d.scheduled_for) : undefined,
      idempotencyKey,
    });
    await tx`update deliveries set provider_delivery_id = ${res.deliveryId}, tracking_url = ${res.trackingUrl}, status = 'requested' where id = ${d.id}`;
  });
}

export async function cancelDelivery(deliveryId: string) {
  await withService(async (tx) => {
    const [d] = (await tx`select d.*, j.tenant_id as tid from deliveries d join jobs j on j.id = d.job_id where d.id = ${deliveryId}`) as (DeliveryRow & { tid: string })[];
    if (!d || d.status === 'cancelled' || d.status === 'delivered') return;
    const tenant = await loadTenantById(d.tid);
    if (tenant && d.provider_delivery_id) await (await deliveryProviderFor(tenant)).cancel(d.provider_delivery_id);
    await tx`update deliveries set status = 'cancelled' where id = ${deliveryId}`;
  });
}

/**
 * Apply a provider status to a delivery and move the job accordingly. Idempotent: statuses only move forward,
 * and the job transition is skipped when the job is not in the matching state.
 */
export async function applyDeliveryStatus(
  tx: Tx,
  delivery: DeliveryRow,
  update: { status: DeliveryStatusValue; rider?: Rider | null; trackingUrl?: string | null; failureReason?: string | null; raw?: unknown },
) {
  const order: DeliveryStatusValue[] = ['requested', 'rider_assigned', 'rider_en_route', 'picked_up', 'in_transit', 'delivered'];
  const terminal: DeliveryStatusValue[] = ['failed', 'cancelled'];
  const current = delivery.status as DeliveryStatusValue;
  const forward = terminal.includes(update.status) || order.indexOf(update.status) > order.indexOf(current);
  if (terminal.includes(current)) return;

  await tx`update deliveries set
      status = ${forward ? update.status : current},
      rider_snapshot = coalesce(${update.rider ? tx.json(update.rider as never) : null}, rider_snapshot),
      tracking_url = coalesce(${update.trackingUrl ?? null}, tracking_url),
      last_provider_status = ${update.status}, last_provider_payload = ${update.raw ? tx.json(update.raw as never) : null}
    where id = ${delivery.id}`;
  if (!forward) return;

  const [job] = (await tx`select * from jobs where id = ${delivery.job_id}`) as JobRow[];
  const go = async (to: JobStatus, from: JobStatus[]) => {
    if (from.includes(job.status)) await tx`select transition_job(${job.id}, ${to}::job_status, 'provider', null, ${tx.json({ delivery_id: delivery.id, reason: update.failureReason ?? undefined } as never)})`;
  };

  if (delivery.leg === 'pickup') {
    switch (update.status) {
      case 'rider_assigned':
      case 'rider_en_route':
        await go('rider_en_route_to_customer', ['pickup_requested']);
        break;
      case 'picked_up':
        await go('picked_up', ['rider_en_route_to_customer']);
        break;
      case 'in_transit':
        await go('picked_up', ['rider_en_route_to_customer']);
        await go('in_transit_to_shop', ['picked_up']);
        break;
      case 'failed':
        await go('pickup_failed', ['pickup_requested', 'rider_en_route_to_customer']);
        break;
    }
  } else {
    switch (update.status) {
      case 'rider_assigned':
      case 'rider_en_route':
        await go('rider_en_route_to_shop', ['return_requested']);
        break;
      case 'picked_up':
        await go('collected_from_shop', ['rider_en_route_to_shop']);
        break;
      case 'in_transit':
        await go('collected_from_shop', ['rider_en_route_to_shop']);
        await go('in_transit_to_customer', ['collected_from_shop']);
        break;
      case 'delivered':
        await go('delivered', ['collected_from_shop', 'in_transit_to_customer']);
        break;
      case 'failed':
        await go('return_failed', ['return_requested', 'rider_en_route_to_shop', 'collected_from_shop', 'in_transit_to_customer']);
        break;
    }
  }
}

export async function activeDelivery(tx: Tx, jobId: string, leg?: 'pickup' | 'return'): Promise<DeliveryRow | null> {
  const rows = (await tx`select * from deliveries where job_id = ${jobId} ${leg ? tx`and leg = ${leg}` : tx``}
    and status in ('requested', 'rider_assigned', 'rider_en_route', 'picked_up', 'in_transit') order by created_at desc limit 1`) as DeliveryRow[];
  return rows[0] ?? null;
}

export type HandoverPoint = 'customer_to_rider' | 'rider_to_shop' | 'shop_to_rider' | 'rider_to_customer';

const POINT_TO_STATUS: Record<HandoverPoint, { to: JobStatus; from: JobStatus[]; actor: ActorKind; leg: 'pickup' | 'return' }> = {
  customer_to_rider: { to: 'picked_up', from: ['rider_en_route_to_customer', 'pickup_requested'], actor: 'customer', leg: 'pickup' },
  rider_to_shop: { to: 'received_at_shop', from: ['picked_up', 'in_transit_to_shop'], actor: 'technician', leg: 'pickup' },
  shop_to_rider: { to: 'collected_from_shop', from: ['rider_en_route_to_shop', 'return_requested'], actor: 'technician', leg: 'return' },
  rider_to_customer: { to: 'delivered', from: ['collected_from_shop', 'in_transit_to_customer'], actor: 'customer', leg: 'return' },
};

/**
 * Verify a rider QR or OTP against the delivery assigned to the job, record the handover and move the job.
 * Runs in the caller's (RLS-scoped) transaction so only the right customer / staff can do it.
 */
export async function recordHandover(
  tx: Tx,
  tenant: Tenant,
  job: JobRow,
  input: { point: HandoverPoint; method: 'qr' | 'otp'; payload: string; actorUserId: string; geo?: { lat: number; lng: number; accuracy?: number } | null; photoIds?: string[] },
): Promise<{ ok: true; rider: Rider | null } | { ok: false; error: 'no_delivery' | 'invalid' | 'wrong_state' }> {
  const spec = POINT_TO_STATUS[input.point];
  if (!spec.from.includes(job.status)) return { ok: false, error: 'wrong_state' };
  const delivery = await activeDelivery(tx, job.id, spec.leg);
  if (!delivery?.provider_delivery_id) return { ok: false, error: 'no_delivery' };
  const provider = await deliveryProviderFor(tenant);
  let rider: Rider | null = delivery.rider_snapshot;
  let valid = false;
  if (input.method === 'qr') {
    const r = await provider.verifyRiderQr(delivery.provider_delivery_id, input.payload);
    valid = r.valid;
    if (r.valid && r.riderName) rider = { name: r.riderName, phone: r.riderPhone ?? '', plate: r.plate ?? null };
  } else {
    valid = await provider.verifyOtp(delivery.provider_delivery_id, input.payload);
  }
  if (!valid) {
    // Failed attempts are evidence too: record them in their own transaction so the caller's rollback keeps them.
    await withService(
      (s) => s`insert into handover_events (job_id, tenant_id, delivery_id, point, method, actor_user_id, geo_lat, geo_lng, geo_accuracy_m, verified, note)
        values (${job.id}, ${tenant.id}, ${delivery.id}, ${input.point}, ${input.method}, ${input.actorUserId}, ${input.geo?.lat ?? null}, ${input.geo?.lng ?? null}, ${input.geo?.accuracy ?? null}, false, 'code did not match the assigned rider')`,
    );
    return { ok: false, error: 'invalid' };
  }
  await tx`insert into handover_events (job_id, tenant_id, delivery_id, point, method, actor_user_id, rider_snapshot, geo_lat, geo_lng, geo_accuracy_m, photo_ids, verified)
    values (${job.id}, ${tenant.id}, ${delivery.id}, ${input.point}, ${input.method}, ${input.actorUserId}, ${rider ? tx.json(rider as never) : null},
            ${input.geo?.lat ?? null}, ${input.geo?.lng ?? null}, ${input.geo?.accuracy ?? null}, ${input.photoIds ?? []}, true)`;

  const deliveryStatus = input.point === 'rider_to_customer' ? 'delivered' : input.point === 'customer_to_rider' || input.point === 'shop_to_rider' ? 'picked_up' : delivery.status;
  await tx`select mark_delivery_handover(${delivery.id}, ${deliveryStatus}::delivery_status, ${rider ? tx.json(rider as never) : null})`;
  // pickup_requested -> picked_up is not an edge: bring the rider "en route" first if the provider never told us.
  if (job.status === 'pickup_requested') await tx`select transition_job(${job.id}, 'rider_en_route_to_customer', 'customer', ${input.actorUserId}, '{}')`;
  if (job.status === 'return_requested') await tx`select transition_job(${job.id}, 'rider_en_route_to_shop', 'technician', ${input.actorUserId}, '{}')`;
  await tx`select transition_job(${job.id}, ${spec.to}::job_status, ${spec.actor}::actor_kind, ${input.actorUserId}, ${tx.json({ delivery_id: delivery.id, method: input.method } as never)})`;
  return { ok: true, rider };
}

/** After a customer/shop handover, providers without in-transit webhooks (mock) go straight to in-transit. */
export async function autoAdvanceAfterHandover(jobId: string, point: HandoverPoint) {
  if (point !== 'customer_to_rider' && point !== 'shop_to_rider') return;
  await withService(async (tx) => {
    const [job] = (await tx`select status, tenant_id from jobs where id = ${jobId}`) as Pick<JobRow, 'status' | 'tenant_id'>[];
    const tenant = await loadTenantById(job.tenant_id);
    if (!tenant || tenant.settings.delivery_provider !== 'mock') return;
    if (point === 'customer_to_rider' && job.status === 'picked_up') await tx`select transition_job(${jobId}, 'in_transit_to_shop', 'provider', null, '{}')`;
    if (point === 'shop_to_rider' && job.status === 'collected_from_shop') await tx`select transition_job(${jobId}, 'in_transit_to_customer', 'provider', null, '{}')`;
  });
}

/** Six-digit code the customer shows at the counter when collecting in person. */
export function collectionCode(jobId: string): string {
  const h = hmacSha256(env().MOCK_PROVIDER_SECRET + ':collection', jobId);
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}
