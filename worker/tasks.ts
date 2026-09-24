import { servicePool, withService } from '@/lib/db';
import { deleteObject, invoiceKey, putObject } from '@/lib/storage';
import { deliveryProviderFor, emailSender, loadTenantSecrets, smsSender } from '@/lib/providers';
import { loadTenantById } from '@/lib/tenant';
import { applyDeliveryStatus, bookLeg, cancelDelivery } from '@/lib/jobs/logistics';
import { reconcilePayment } from '@/lib/jobs/payments';
import { renderInvoicePdf } from '@/lib/invoice-pdf';
import type { DeliveryRow, JobRow } from '@/lib/jobs/types';

/**
 * Background work (DECISIONS D-3/D-17). Every function here is safe to run concurrently on several instances:
 * rows are claimed with SKIP LOCKED and every action is idempotent.
 */

const log = (...a: unknown[]) => console.log(new Date().toISOString(), '[worker]', ...a);

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------
export async function processOutbox(limit = 20): Promise<number> {
  const sql = servicePool();
  const rows = await sql`update outbox set attempts = attempts + 1 where id in (
      select id from outbox where status = 'pending' and next_attempt_at <= now() order by id limit ${limit} for update skip locked
    ) returning *`;
  for (const row of rows) {
    try {
      await runOutbox(row.kind, row.payload);
      await sql`update outbox set status = 'done', done_at = now(), last_error = null where id = ${row.id}`;
    } catch (e) {
      const err = (e as Error).message.slice(0, 500);
      const retryable = (e as { retryable?: boolean }).retryable !== false;
      const attempts = Number(row.attempts);
      const dead = !retryable || attempts >= 8;
      const backoff = Math.min(2 ** attempts * 15, 3600);
      await sql`update outbox set status = ${dead ? 'dead' : 'pending'}, last_error = ${err}, next_attempt_at = now() + make_interval(secs => ${backoff}) where id = ${row.id}`;
      log(`outbox ${row.id} ${row.kind} failed (${attempts}): ${err}`);
      if (dead) await alertPlatform(row.tenant_id, `Outbox job ${row.kind} #${row.id} gave up: ${err}`);
    }
  }
  return rows.length;
}

async function runOutbox(kind: string, payload: Record<string, string>) {
  switch (kind) {
    case 'delivery.create':
      return bookLeg(payload.job_id, payload.leg as 'pickup' | 'return');
    case 'delivery.cancel':
      return cancelDelivery(payload.delivery_id);
    case 'invoice.pdf':
      return generateInvoicePdf(payload.invoice_id);
    default:
      throw Object.assign(new Error(`unknown outbox kind ${kind}`), { retryable: false });
  }
}

export async function generateInvoicePdf(invoiceId: string) {
  const sql = servicePool();
  const [inv] = await sql`select i.*, j.ref as job_ref, trim(j.device_brand || ' ' || j.device_model) as device, j.warranty_until
    from invoices i join jobs j on j.id = i.job_id where i.id = ${invoiceId}`;
  if (!inv) return;
  const payments = await sql`select mpesa_receipt as receipt, amount_cents, purpose, confirmed_at from payments where job_id = ${inv.job_id} and status = 'success' order by confirmed_at`;
  const pdf = await renderInvoicePdf({
    ...inv,
    subtotal_cents: Number(inv.subtotal_cents),
    vat_cents: Number(inv.vat_cents),
    vat_rate_bp: Number(inv.vat_rate_bp),
    rounding_cents: Number(inv.rounding_cents),
    total_cents: Number(inv.total_cents),
    paid_cents: Number(inv.paid_cents),
    balance_cents: Number(inv.balance_cents),
    payments: payments.map((p) => ({ receipt: p.receipt, purpose: p.purpose, confirmed_at: p.confirmed_at, amount_cents: Number(p.amount_cents) })),
  });
  const key = invoiceKey(inv.tenant_id, inv.id);
  await putObject(key, pdf, 'application/pdf');
  await sql`update invoices set pdf_key = ${key} where id = ${invoiceId}`;
}

// ---------------------------------------------------------------------------
// Notifications (SMS / email); in_app rows need no delivery
// ---------------------------------------------------------------------------
export async function sendNotifications(limit = 30): Promise<number> {
  const sql = servicePool();
  const rows = await sql`update notifications set attempts = attempts + 1, status = 'queued' where id in (
      select id from notifications where status in ('queued', 'held_quiet_hours') and channel in ('sms', 'email') and send_after <= now() and attempts < 5
      order by send_after limit ${limit} for update skip locked
    ) returning *`;
  for (const n of rows) {
    try {
      const tenant = await loadTenantById(n.tenant_id);
      const secrets = tenant ? await loadTenantSecrets(tenant.id) : undefined;
      if (n.channel === 'sms') {
        if (!n.phone_e164) throw new Error('no phone');
        const r = await smsSender(tenant, secrets).send({ to: n.phone_e164, body: n.body, senderId: tenant?.branding.sms_sender_id });
        if (!r.ok) throw new Error(r.error ?? 'sms failed');
        await sql`update notifications set status = 'sent', sent_at = now(), provider_message_id = ${r.messageId ?? null}, last_error = null where id = ${n.id}`;
      } else {
        if (!n.email) throw new Error('no email');
        const r = await emailSender().send({ to: n.email, subject: n.title ?? `${tenant?.branding.display_name ?? 'Repair'} update`, text: n.body, fromName: tenant?.branding.email_from_name ?? tenant?.branding.display_name });
        if (!r.ok) throw new Error(r.error ?? 'email failed');
        await sql`update notifications set status = 'sent', sent_at = now(), provider_message_id = ${r.messageId ?? null}, last_error = null where id = ${n.id}`;
      }
    } catch (e) {
      const err = (e as Error).message.slice(0, 300);
      await sql`update notifications set status = ${Number(n.attempts) >= 4 ? 'failed' : 'queued'}, last_error = ${err}, send_after = now() + make_interval(secs => ${60 * Number(n.attempts)}) where id = ${n.id}`;
      log(`notification ${n.id} failed: ${err}`);
    }
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------
export async function fireTimers(limit = 50): Promise<number> {
  const sql = servicePool();
  const rows = await sql`update timers set fired_at = now() where id in (
      select id from timers where fired_at is null and cancelled_at is null and due_at <= now() order by due_at limit ${limit} for update skip locked
    ) returning *`;
  for (const t of rows) {
    try {
      await withService(async (tx) => {
        const job = t.job_id ? ((await tx`select * from jobs where id = ${t.job_id} for update`) as JobRow[])[0] : null;
        switch (t.kind) {
          case 'payment_reconcile':
            return reconcilePayment(t.payment_id);
          case 'quote_expiry':
            if (job && ['quote_sent', 'quote_negotiating'].includes(job.status)) {
              await tx`update quotes set status = 'expired' where job_id = ${job.id} and kind = 'main' and status in ('sent', 'negotiating')`;
              await tx`insert into negotiations (quote_id, tenant_id, author_side, kind) select id, tenant_id, 'shop', 'expired' from quotes where job_id = ${job.id} and kind = 'main'`;
              await tx`select transition_job(${job.id}, 'quote_expired', 'system', null, '{}')`;
            }
            return;
          case 'expired_quote_autodecline':
            if (job?.status === 'quote_expired') {
              await tx`update quotes set status = 'declined' where job_id = ${job.id} and kind = 'main' and status = 'expired'`;
              await tx`select transition_job(${job.id}, 'quote_declined', 'system', null, ${tx.json({ reason: 'Quote expired without a response' })})`;
            }
            return;
          case 'deposit_reminder':
            if (job?.status === 'deposit_pending') await tx`select notify_job(${job.id}, 'reminder.deposit', '{}')`;
            return;
          case 'final_payment_reminder':
            if (job?.status === 'final_payment_pending') await tx`select notify_job(${job.id}, 'reminder.final_payment', '{}')`;
            return;
          case 'dropoff_reminder':
            if (job?.status === 'repair_complete') {
              await tx`select notify_job(${job.id}, 'reminder.dropoff', '{}')`;
              const count = Number(t.payload?.count ?? 1);
              if (count < 3) await tx`insert into timers (tenant_id, job_id, kind, due_at, payload) values (${t.tenant_id}, ${job.id}, 'dropoff_reminder', now() + interval '24 hours', ${tx.json({ count: count + 1 })})`;
            }
            return;
          case 'unclaimed_alert':
            if (job && ['repair_complete', 'ready_for_collection', 'return_failed'].includes(job.status)) await tx`select notify_job(${job.id}, 'alert.unclaimed', '{}')`;
            return;
          case 'auto_close':
            if (job?.status === 'delivered') {
              const to = job.outcome === 'repaired' ? 'closed' : job.outcome === 'declined' ? 'declined_returned' : 'cancelled';
              await tx`select transition_job(${job.id}, ${to}::job_status, 'system', null, ${tx.json({ reason: 'Auto-closed 48h after delivery' })})`;
            }
            return;
          case 'retention_sweep':
            return retentionSweep();
        }
      });
    } catch (e) {
      log(`timer ${t.id} ${t.kind} failed: ${(e as Error).message}`);
      await sql`update timers set fired_at = null, due_at = now() + interval '10 minutes', payload = payload || ${sql.json({ last_error: (e as Error).message.slice(0, 300) })} where id = ${t.id}`;
    }
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Courier polling (mock always; TumaBoda as a safety net next to webhooks)
// ---------------------------------------------------------------------------
export async function pollDeliveries(limit = 50): Promise<number> {
  const sql = servicePool();
  const rows = (await sql`select d.* from deliveries d
    where d.status in ('requested', 'rider_assigned', 'rider_en_route') and d.provider_delivery_id is not null
      and d.updated_at < now() - interval '10 seconds'
    order by d.updated_at limit ${limit}`) as DeliveryRow[];
  let n = 0;
  for (const d of rows) {
    try {
      const [{ tenant_id }] = await sql`select tenant_id from jobs where id = ${d.job_id}`;
      const tenant = await loadTenantById(tenant_id);
      if (!tenant) continue;
      const provider = await deliveryProviderFor(tenant);
      if (!provider.capabilities.polling) continue;
      const st = await provider.status(d.provider_delivery_id!);
      await withService(async (tx) => {
        const [fresh] = (await tx`select * from deliveries where id = ${d.id} for update`) as DeliveryRow[];
        if (fresh.status !== st.status) {
          await applyDeliveryStatus(tx, fresh, { status: st.status, rider: st.rider, trackingUrl: st.trackingUrl, failureReason: st.failureReason, raw: st.raw });
          n++;
        } else {
          await tx`update deliveries set updated_at = now() where id = ${d.id}`;
        }
      });
    } catch (e) {
      log(`poll ${d.id} failed: ${(e as Error).message}`);
      await sql`update deliveries set updated_at = now() where id = ${d.id}`;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// Retention: photos of closed jobs older than the tenant's retention period
// ---------------------------------------------------------------------------
export async function retentionSweep(): Promise<number> {
  const sql = servicePool();
  const rows = await sql`select p.id, p.storage_key from job_photos p
    join jobs j on j.id = p.job_id join tenant_settings s on s.tenant_id = j.tenant_id
    where p.deleted_at is null and j.closed_at is not null and j.closed_at < now() - make_interval(days => s.retention_days)
    limit 200`;
  for (const p of rows) {
    try {
      await deleteObject(p.storage_key);
    } catch (e) {
      log(`delete ${p.storage_key}: ${(e as Error).message}`);
    }
    await sql`update job_photos set deleted_at = now() where id = ${p.id}`;
  }
  // make sure a daily sweep is always scheduled
  await sql`insert into timers (tenant_id, kind, due_at) select '00000000-0000-0000-0000-000000000000', 'retention_sweep', now() + interval '24 hours'
    where not exists (select 1 from timers where kind = 'retention_sweep' and fired_at is null and cancelled_at is null)`;
  return rows.length;
}

async function alertPlatform(tenantId: string, message: string) {
  const sql = servicePool();
  await sql`insert into notifications (tenant_id, user_id, channel, event_key, title, body)
    select ${tenantId}, u.id, 'in_app', 'platform.alert', 'Integration failure', ${message} from users u where u.is_platform_admin and not u.disabled`;
}

/** One pass over everything. Returns how much work was done so the loop can back off when idle. */
export async function tick(): Promise<number> {
  const results = await Promise.allSettled([processOutbox(), sendNotifications(), fireTimers(), pollDeliveries()]);
  let total = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') total += r.value;
    else log('tick error', r.reason);
  }
  return total;
}
