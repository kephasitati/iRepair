import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser, closeAll, paySuccess, resetDb, seedBasics, seedDraftJob, service, status, transition, type Seed } from './helpers';

let s: Seed;

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
});
afterAll(closeAll);

async function acceptedQuote(jobId: string, totalCents = 1_500_000, depositCents = 750_000) {
  return asService(async (tx) => {
    const [q] = await tx`insert into quotes (job_id, tenant_id, kind, status, created_by) values (${jobId}, ${s.tenantA}, 'main', 'draft', ${s.techA}) returning id`;
    const [v] = await tx`insert into quote_versions (quote_id, tenant_id, version_no, author_side, subtotal_cents, vat_cents, total_cents, deposit_cents, expires_at, sent_at, created_by)
      values (${q.id}, ${s.tenantA}, 1, 'shop', ${totalCents - 200000}, 200000, ${totalCents}, ${depositCents}, now() + interval '48 hours', now(), ${s.techA}) returning id`;
    await tx`update quotes set current_version_id = ${v.id}, status = 'accepted', accepted_version_id = ${v.id}, accepted_total_cents = ${totalCents}, accepted_at = now() where id = ${q.id}`;
    return q.id as string;
  });
}

async function sentQuote(jobId: string) {
  return asService(async (tx) => {
    const [q] = await tx`insert into quotes (job_id, tenant_id, kind, status, created_by) values (${jobId}, ${s.tenantA}, 'main', 'sent', ${s.techA}) returning id`;
    const [v] = await tx`insert into quote_versions (quote_id, tenant_id, version_no, author_side, total_cents, deposit_cents, expires_at, sent_at, created_by)
      values (${q.id}, ${s.tenantA}, 1, 'shop', 1500000, 750000, now() + interval '48 hours', now(), ${s.techA}) returning id`;
    await tx`update quotes set current_version_id = ${v.id} where id = ${q.id}`;
    return q.id as string;
  });
}

async function intake(jobId: string, withDiscrepancy = false) {
  await asService(async (tx) => {
    await tx`insert into intake_checklists (job_id, tenant_id, identifier_read, identifier_matches, powers_on, summary, completed_by) values (${jobId}, ${s.tenantA}, '490154203237518', true, true, 'ok', ${s.techA})`;
    if (withDiscrepancy) await tx`insert into discrepancies (job_id, tenant_id, field, declared_value, observed_value) values (${jobId}, ${s.tenantA}, 'back_glass', 'intact', 'cracked')`;
  });
}

async function proforma(jobId: string, totalCents: number) {
  await asService(async (tx) => {
    await tx`insert into invoices (tenant_id, job_id, lines, subtotal_cents, vat_cents, vat_rate_bp, total_cents, paid_cents, balance_cents, customer_snapshot, tenant_snapshot)
      values (${s.tenantA}, ${jobId}, '[]', ${totalCents}, 0, 1600, ${totalCents}, ${await paidCents(jobId)}, ${totalCents - (await paidCents(jobId))}, '{}', '{}')`;
  });
}
async function paidCents(jobId: string) {
  const [r] = await service`select paid_cents(${jobId}) as c`;
  return Number(r.c);
}

describe('happy path: book -> pay -> pickup -> intake -> quote -> deposit -> repair -> pay -> return -> close', () => {
  let job: string;

  it('customer submits the wizard', async () => {
    job = await seedDraftJob(s.tenantA, s.customer1);
    await transition(job, 'pickup_fee_pending', 'customer', s.customer1);
    expect(await status(job)).toBe('pickup_fee_pending');
  });

  it('pickup fee confirmation moves to pickup_requested and queues the courier booking', async () => {
    await paySuccess(job, s.tenantA, 'pickup_fee', 80000);
    expect(await status(job)).toBe('pickup_requested');
    const ob = await service`select kind, payload from outbox where payload ->> 'job_id' = ${job}`;
    expect(ob).toEqual([{ kind: 'delivery.create', payload: { job_id: job, leg: 'pickup' } }]);
    const sms = await service`select body from notifications where job_id = ${job} and channel = 'sms' order by created_at`;
    expect(sms.map((r) => r.body).join(' ')).toMatch(/rider is being assigned/);
    expect(sms.map((r) => r.body).join(' ')).toMatch(/M-Pesa receipt/);
  });

  it('provider events drive the pickup leg', async () => {
    await transition(job, 'rider_en_route_to_customer', 'provider');
    await transition(job, 'picked_up', 'customer', s.customer1);
    await transition(job, 'in_transit_to_shop', 'provider');
    expect(await status(job)).toBe('in_transit_to_shop');
  });

  it('technician cannot skip intake', async () => {
    await transition(job, 'received_at_shop', 'technician', s.techA);
    await expect(transition(job, 'diagnosing', 'technician', s.techA)).rejects.toThrow(/intake checklist/);
    await intake(job);
    await transition(job, 'diagnosing', 'technician', s.techA);
  });

  it('quote must be sent before quote_sent, accepted before deposit_pending', async () => {
    await expect(transition(job, 'quote_sent', 'technician', s.techA)).rejects.toThrow(/quote version must be sent/);
    const q = await sentQuote(job);
    await transition(job, 'quote_sent', 'technician', s.techA);
    const timers = await service`select kind from timers where job_id = ${job} and cancelled_at is null and fired_at is null`;
    expect(timers.map((t) => t.kind)).toContain('quote_expiry');
    await expect(transition(job, 'deposit_pending', 'customer', s.customer1)).rejects.toThrow(/accepted/);
    await asService((tx) => tx`update quotes set status = 'accepted', accepted_version_id = current_version_id, accepted_total_cents = 1500000 where id = ${q}`);
    await transition(job, 'deposit_pending', 'customer', s.customer1);
    const after = await service`select kind from timers where job_id = ${job} and cancelled_at is null and fired_at is null`;
    expect(after.map((t) => t.kind)).toEqual(['deposit_reminder']);
  });

  it('deposit confirmation starts the repair and sets outcome', async () => {
    await paySuccess(job, s.tenantA, 'deposit', 750000);
    expect(await status(job)).toBe('in_repair');
    const [j] = await service`select outcome from jobs where id = ${job}`;
    expect(j.outcome).toBe('repaired');
  });

  it('completion needs the checklist, then the customer picks drop-off and pays the balance', async () => {
    await expect(transition(job, 'repair_complete', 'technician', s.techA)).rejects.toThrow(/completion checklist/);
    await asService((tx) => tx`insert into completion_checklists (job_id, tenant_id, completed_by) values (${job}, ${s.tenantA}, ${s.techA})`);
    await transition(job, 'repair_complete', 'technician', s.techA);
    await expect(transition(job, 'final_payment_pending', 'customer', s.customer1)).rejects.toThrow(/drop-off choice/);
    await asService((tx) => tx`update jobs set dropoff_choice = 'pickup_address', dropoff_address = pickup_address, return_fee_cents = 35000 where id = ${job}`);
    await expect(transition(job, 'final_payment_pending', 'customer', s.customer1)).rejects.toThrow(/proforma/);
    // total = 50k consultation + 30k pickup courier + 1.5m quote - 50k credit + 35k return = 1,565,000
    await proforma(job, 1_565_000);
    await transition(job, 'final_payment_pending', 'customer', s.customer1);
    await paySuccess(job, s.tenantA, 'final_balance', 1_565_000 - 830_000);
    // dispatch_pending is momentary; the job should already be on the return leg.
    expect(await status(job)).toBe('return_requested');
    const [inv] = await service`select status, number, balance_cents from invoices where job_id = ${job}`;
    expect(inv.status).toBe('issued');
    expect(inv.number).toMatch(/^INV-\d{4}-000001$/);
    expect(Number(inv.balance_cents)).toBe(0);
    const ob = await service`select kind, payload from outbox where payload ->> 'job_id' = ${job} or payload ->> 'invoice_id' is not null order by id`;
    expect(ob.map((o) => o.kind)).toEqual(['delivery.create', 'invoice.pdf', 'delivery.create']);
  });

  it('return leg, delivery, rating, close with warranty and passcode purge', async () => {
    await asService((tx) => tx`update job_secrets set passcode_enc = 'v1.x.y.z' where job_id = ${job}`);
    await transition(job, 'rider_en_route_to_shop', 'provider');
    await transition(job, 'collected_from_shop', 'technician', s.techA);
    await transition(job, 'in_transit_to_customer', 'provider');
    await transition(job, 'delivered', 'provider');
    const [j1] = await service`select warranty_until from jobs where id = ${job}`;
    expect(j1.warranty_until).not.toBeNull();
    await expect(transition(job, 'declined_returned', 'customer', s.customer1)).rejects.toThrow(/only declined/);
    await transition(job, 'closed', 'customer', s.customer1);
    const [sec] = await service`select passcode_enc, purged_at from job_secrets where job_id = ${job}`;
    expect(sec.passcode_enc).toBeNull();
    expect(sec.purged_at).not.toBeNull();
    const events = await service`select from_status, to_status from job_events where job_id = ${job} and event_kind = 'transition' order by id`;
    expect(events.map((e) => e.to_status)).toEqual([
      'pickup_fee_pending', 'pickup_requested', 'rider_en_route_to_customer', 'picked_up', 'in_transit_to_shop', 'received_at_shop', 'diagnosing',
      'quote_sent', 'deposit_pending', 'in_repair', 'repair_complete', 'final_payment_pending', 'dispatch_pending', 'return_requested',
      'rider_en_route_to_shop', 'collected_from_shop', 'in_transit_to_customer', 'delivered', 'closed',
    ]);
    // nothing survives after a terminal state
    await expect(transition(job, 'in_repair', 'shop_admin', s.adminA)).rejects.toThrow(/Illegal/);
  });
});

describe('declined path', () => {
  it('decline -> return fee -> return -> declined_returned, consultation kept', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'diagnosing' });
    await sentQuote(job);
    await transition(job, 'quote_sent', 'technician', s.techA);
    await transition(job, 'quote_declined', 'customer', s.customer1);
    expect(await status(job)).toBe('return_fee_pending');
    const [j] = await service`select outcome from jobs where id = ${job}`;
    expect(j.outcome).toBe('declined');
    await asService((tx) => tx`update jobs set return_fee_cents = 30000, dropoff_choice = 'pickup_address', dropoff_address = pickup_address where id = ${job}`);
    await paySuccess(job, s.tenantA, 'return_fee', 30000);
    expect(await status(job)).toBe('return_requested');
    await transition(job, 'rider_en_route_to_shop', 'provider');
    await transition(job, 'collected_from_shop', 'technician', s.techA);
    await transition(job, 'delivered', 'provider');
    await expect(transition(job, 'closed', 'system')).rejects.toThrow(/only repaired/);
    await transition(job, 'declined_returned', 'system');
    expect(await status(job)).toBe('declined_returned');
  });

  it('customer may instead collect at the shop', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'return_fee_pending' });
    await transition(job, 'ready_for_collection', 'customer', s.customer1);
    const [j] = await service`select dropoff_choice from jobs where id = ${job}`;
    expect(j.dropoff_choice).toBe('collect_at_shop');
  });
});

describe('intake discrepancy flow', () => {
  it('blocks diagnosis until the customer acknowledges', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'received_at_shop' });
    await intake(job, true);
    await expect(transition(job, 'diagnosing', 'technician', s.techA)).rejects.toThrow(/acknowledged/);
    await transition(job, 'intake_ack_pending', 'technician', s.techA);
    await expect(transition(job, 'diagnosing', 'customer', s.customer1)).rejects.toThrow(/acknowledged/);
    await asService((tx) => tx`update discrepancies set acknowledged_at = now() where job_id = ${job}`);
    await expect(transition(job, 'diagnosing', 'technician', s.techA)).rejects.toThrow(/Illegal/);
    await transition(job, 'diagnosing', 'customer', s.customer1);
    const [j] = await service`select intake_discrepancy from jobs where id = ${job}`;
    expect(j.intake_discrepancy).toBe(true);
  });

  it('customer can reject the discrepancy and have the device returned', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'intake_ack_pending' });
    await transition(job, 'return_fee_pending', 'customer', s.customer1);
    expect(await status(job)).toBe('return_fee_pending');
  });
});

describe('cancellation', () => {
  it('customer cancels free before pickup, and after booking a courier the delivery is cancelled', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1);
    await transition(job, 'cancelled', 'customer', s.customer1);
    expect(await status(job)).toBe('cancelled');

    const job2 = await seedDraftJob(s.tenantA, s.customer1, { status: 'pickup_requested' });
    await asService((tx) => tx`insert into deliveries (job_id, tenant_id, leg, provider, status, pickup_address, dropoff_address, provider_delivery_id) values (${job2}, ${s.tenantA}, 'pickup', 'mock', 'requested', '{}', '{}', 'm1')`);
    await expect(transition(job2, 'cancelled', 'customer', s.customer1)).rejects.toThrow(/reason/);
    await transition(job2, 'cancelled', 'customer', s.customer1, { reason: 'Changed my mind' });
    const ob = await service`select kind from outbox where kind = 'delivery.cancel'`;
    expect(ob).toHaveLength(1);
  });

  it('customer cannot cancel after deposit; shop_admin can with a reason', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'in_repair' });
    await expect(transition(job, 'cancelled', 'customer', s.customer1, { reason: 'x' })).rejects.toThrow(/Illegal/);
    await expect(transition(job, 'return_fee_pending', 'technician', s.techA)).rejects.toThrow(/Illegal/);
    await transition(job, 'return_fee_pending', 'shop_admin', s.adminA, { outcome: 'cancelled', reason: 'Parts unavailable' });
    const [j] = await service`select outcome from jobs where id = ${job}`;
    expect(j.outcome).toBe('cancelled');
  });
});

describe('authorisation inside transition_job', () => {
  it('rejects the wrong customer, non-staff, technicians on admin-only edges, and untrusted system calls', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1);
    await expect(transition(job, 'pickup_fee_pending', 'customer', s.customer2)).rejects.toThrow(/not the customer/);
    await expect(transition(job, 'cancelled', 'shop_admin', s.adminB)).rejects.toThrow(/not a shop admin/);
    await expect(transition(job, 'cancelled', 'shop_admin', s.techA)).rejects.toThrow(/not a shop admin/);
    const job2 = await seedDraftJob(s.tenantA, s.customer1, { status: 'pickup_fee_pending' });
    await expect(asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select transition_job(${job2}, 'pickup_requested', 'system')`)).rejects.toThrow(/trusted/);
  });

  it('app-role calls work for the right customer and staff', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1);
    await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select transition_job(${job}, 'pickup_fee_pending', 'customer', ${s.customer1})`);
    expect(await status(job)).toBe('pickup_fee_pending');
    const job2 = await seedDraftJob(s.tenantA, s.customer1, { status: 'in_transit_to_shop' });
    await asUser({ userId: s.techA, tenantId: s.tenantA }, (tx) => tx`select transition_job(${job2}, 'received_at_shop', 'technician', ${s.techA})`);
    expect(await status(job2)).toBe('received_at_shop');
    await expect(asUser({ userId: s.tech2A, tenantId: s.tenantA }, (tx) => tx`select transition_job(${job2}, 'return_fee_pending', 'shop_admin', ${s.adminA})`)).rejects.toThrow(/not a shop admin/);
  });
});

describe('payments', () => {
  it('duplicate callbacks are harmless and amount mismatches are refused', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'pickup_fee_pending' });
    const [p] = await asService((tx) => tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, checkout_request_id, status)
      values (${s.tenantA}, ${job}, 'pickup_fee', 80000, '+254722000001', 'dup1', 'dup1cb', 'ws_dup1', 'pending') returning *`);
    const bad = await asService((tx) => tx`select * from confirm_payment(${p.checkout_request_id}, 0, 'Success', 'RCPT1', 50000, '{}')`);
    expect(bad[0].status).toBe('failed');
    expect(bad[0].result_desc).toMatch(/mismatch/);
    expect(await status(job)).toBe('pickup_fee_pending');

    const [p2] = await asService((tx) => tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, checkout_request_id, status)
      values (${s.tenantA}, ${job}, 'pickup_fee', 80000, '+254722000001', 'dup2', 'dup2cb', 'ws_dup2', 'pending') returning *`);
    const a = await asService((tx) => tx`select * from confirm_payment(${p2.checkout_request_id}, 0, 'Success', 'RCPT2', 80000, '{}')`);
    const b = await asService((tx) => tx`select * from confirm_payment(${p2.checkout_request_id}, 0, 'Success', 'RCPT2', 80000, '{}')`);
    expect(a[0].status).toBe('success');
    expect(b[0].confirmed_at).toEqual(a[0].confirmed_at);
    expect(await status(job)).toBe('pickup_requested');
    const events = await service`select count(*)::int as n from job_events where job_id = ${job} and to_status = 'pickup_requested'`;
    expect(events[0].n).toBe(1);
  });

  it('cancel, timeout and insufficient funds are recorded and the job waits for a retry', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'pickup_fee_pending' });
    const mk = async (k: string) => (await asService((tx) => tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, checkout_request_id, status)
      values (${s.tenantA}, ${job}, 'pickup_fee', 80000, '+254722000001', ${k}, ${k + 'cb'}, ${'ws_' + k}, 'pending') returning checkout_request_id`))[0].checkout_request_id;
    const results = await Promise.all(
      [[await mk('c1'), 1032], [await mk('c2'), 1037], [await mk('c3'), 1]].map(([id, code]) =>
        asService((tx) => tx`select status from confirm_payment(${id as string}, ${code as number}, 'x')`),
      ),
    );
    expect(results.map((r) => r[0].status)).toEqual(['cancelled', 'timeout', 'failed']);
    expect(await status(job)).toBe('pickup_fee_pending');
    await expect(asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select confirm_payment('ws_c1', 0, 'x')`)).rejects.toThrow(/trusted/);
  });

  it('final payment guard refuses a short payment', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'in_repair' });
    await acceptedQuote(job);
    await asService(async (tx) => {
      await tx`insert into completion_checklists (job_id, tenant_id) values (${job}, ${s.tenantA})`;
      await tx`update jobs set dropoff_choice = 'collect_at_shop' where id = ${job}`;
    });
    await transition(job, 'repair_complete', 'technician', s.techA);
    await proforma(job, 1_500_000);
    await transition(job, 'final_payment_pending', 'customer', s.customer1);
    await paySuccess(job, s.tenantA, 'final_balance', 100_000);
    expect(await status(job)).toBe('final_payment_pending');
    await paySuccess(job, s.tenantA, 'final_balance', 1_400_000);
    expect(await status(job)).toBe('ready_for_collection');
  });
});

describe('notifications & quiet hours', () => {
  it('tenant template overrides the default and non-critical SMS is held in quiet hours', async () => {
    await asService((tx) => tx`insert into notification_templates (tenant_id, event_key, audience, channel, body, critical) values (${s.tenantA}, 'job.received_at_shop', 'customer', 'sms', 'CUSTOM {job_ref}', false)`);
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'in_transit_to_shop' });
    await transition(job, 'received_at_shop', 'technician', s.techA);
    const rows = await service`select body, status, send_after from notifications where job_id = ${job} and channel = 'sms'`;
    expect(rows).toHaveLength(1);
    expect(rows[0].body).toMatch(/^CUSTOM DR-/);
    const [{ quiet }] = await service`select in_quiet_hours(now(), '21:00', '07:00') as quiet`;
    if (quiet) {
      expect(rows[0].status).toBe('held_quiet_hours');
      expect(new Date(rows[0].send_after).getTime()).toBeGreaterThan(Date.now());
    } else {
      expect(rows[0].status).toBe('queued');
    }
  });

  it('SQL and TS quiet-hour helpers agree', async () => {
    const [{ a, b, c }] = await service`select in_quiet_hours('2026-09-25T19:30:00Z', '21:00', '07:00') as a, in_quiet_hours('2026-09-25T04:00:00Z', '21:00', '07:00') as b,
      quiet_hours_release('2026-09-25T19:30:00Z', '21:00', '07:00') as c`;
    expect(a).toBe(true);
    expect(b).toBe(false);
    expect(new Date(c).toISOString()).toBe('2026-09-26T04:00:00.000Z');
  });
});
