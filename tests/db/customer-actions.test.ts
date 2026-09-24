import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser, closeAll, resetDb, seedBasics, seedDraftJob, service, type Seed } from './helpers';

/**
 * Regression tests for writes customers make through the app role. A blocked RLS UPDATE does not raise an error, it
 * silently changes nothing, so every customer write that touches staff-owned tables must go through a checked function.
 */
let s: Seed;

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
});
afterAll(closeAll);

async function sentQuote(jobId: string, maxRoundsUsed = 0) {
  return asService(async (tx) => {
    const [q] = await tx`insert into quotes (job_id, tenant_id, kind, status, rounds_used) values (${jobId}, ${s.tenantA}, 'main', 'sent', ${maxRoundsUsed}) returning id`;
    const [v] = await tx`insert into quote_versions (quote_id, tenant_id, version_no, author_side, total_cents, deposit_cents, expires_at, sent_at)
      values (${q.id}, ${s.tenantA}, 1, 'shop', 1500000, 750000, now() + interval '1 day', now()) returning id`;
    await tx`update quotes set current_version_id = ${v.id} where id = ${q.id}`;
    return { quoteId: q.id as string, versionId: v.id as string };
  });
}

const asCustomer = <T,>(fn: Parameters<typeof asUser<T>>[1], user = () => s.customer1, tenant = () => s.tenantA) => asUser({ userId: user(), tenantId: tenant() }, fn);

describe('customer quote actions really change the quote', () => {
  it('a direct UPDATE by the customer is silently ignored (why the checked function exists)', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId } = await sentQuote(job);
    const res = await asCustomer((tx) => tx`update quotes set status = 'accepted' where id = ${quoteId}`);
    expect(res.count).toBe(0);
  });

  it('counter moves the quote to negotiating and counts the round', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId } = await sentQuote(job);
    await asCustomer((tx) => tx`select customer_quote_action(${quoteId}, 'counter')`);
    const [q] = await service`select status, rounds_used from quotes where id = ${quoteId}`;
    expect(q).toMatchObject({ status: 'negotiating', rounds_used: 1 });
  });

  it('counter respects the round cap', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId } = await sentQuote(job, 3);
    await expect(asCustomer((tx) => tx`select customer_quote_action(${quoteId}, 'counter')`)).rejects.toThrow(/no more counter-offers/);
  });

  it('accept records the accepted version and total, then the job can move to deposit_pending', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId, versionId } = await sentQuote(job);
    await asCustomer(async (tx) => {
      await tx`select customer_quote_action(${quoteId}, 'accept', ${versionId})`;
      await tx`select transition_job(${job}, 'deposit_pending', 'customer', ${s.customer1})`;
    });
    const [q] = await service`select status, accepted_version_id, accepted_total_cents from quotes where id = ${quoteId}`;
    expect(q.status).toBe('accepted');
    expect(q.accepted_version_id).toBe(versionId);
    expect(Number(q.accepted_total_cents)).toBe(1500000);
  });

  it('accept refuses a stale version', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId } = await sentQuote(job);
    const other = (await sentQuote(await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' }))).versionId;
    await expect(asCustomer((tx) => tx`select customer_quote_action(${quoteId}, 'accept', ${other})`)).rejects.toThrow(/quote has changed/);
  });

  it('another customer, or the same customer on another shop host, cannot act on the quote', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId } = await sentQuote(job);
    await expect(asCustomer((tx) => tx`select customer_quote_action(${quoteId}, 'decline')`, () => s.customer2)).rejects.toThrow(/not the customer/);
    await expect(asCustomer((tx) => tx`select customer_quote_action(${quoteId}, 'decline')`, () => s.customer1, () => s.tenantB)).rejects.toThrow(/not the customer/);
  });

  it('decline works from sent', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'quote_sent' });
    const { quoteId } = await sentQuote(job);
    await asCustomer((tx) => tx`select customer_quote_action(${quoteId}, 'decline')`);
    const [q] = await service`select status from quotes where id = ${quoteId}`;
    expect(q.status).toBe('declined');
  });
});

describe('handover delivery update', () => {
  it('needs a verified handover and a job the caller can see', async () => {
    const job = await seedDraftJob(s.tenantA, s.customer1, { status: 'rider_en_route_to_customer' });
    const [d] = await asService((tx) => tx`insert into deliveries (job_id, tenant_id, leg, provider, status, pickup_address, dropoff_address, provider_delivery_id)
      values (${job}, ${s.tenantA}, 'pickup', 'mock', 'rider_en_route', '{}', '{}', 'mock_x') returning id`);
    await expect(asCustomer((tx) => tx`select mark_delivery_handover(${d.id}, 'picked_up')`)).rejects.toThrow(/no verified handover/);
    await expect(asCustomer((tx) => tx`select mark_delivery_handover(${d.id}, 'picked_up')`, () => s.customer2)).rejects.toThrow(/not allowed/);
    await asCustomer(async (tx) => {
      await tx`insert into handover_events (job_id, tenant_id, delivery_id, point, method, actor_user_id, verified) values (${job}, ${s.tenantA}, ${d.id}, 'customer_to_rider', 'qr', ${s.customer1}, true)`;
      await tx`select mark_delivery_handover(${d.id}, 'picked_up', ${tx.json({ name: 'Rider', phone: '+254700000000' })})`;
    });
    const [row] = await service`select status, rider_snapshot from deliveries where id = ${d.id}`;
    expect(row.status).toBe('picked_up');
    expect(row.rider_snapshot).toMatchObject({ name: 'Rider' });
  });
});
