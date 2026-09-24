import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asService, asUser, closeAll, resetDb, seedBasics, seedDraftJob, service, type Seed } from './helpers';

let s: Seed;
let jobA: string;
let jobB: string;

const BUSINESS_TABLES = [
  'jobs', 'job_secrets', 'job_events', 'job_photos', 'intake_checklists', 'discrepancies', 'job_progress_updates',
  'completion_checklists', 'ratings', 'disputes', 'quotes', 'quote_versions', 'quote_line_items', 'negotiations',
  'parts_catalogue', 'deliveries', 'handover_events', 'payments', 'refunds', 'invoices', 'notifications',
  'tenant_settings', 'tenant_branding', 'tenant_secrets', 'tenant_memberships', 'audit_log', 'short_links', 'timers',
];

beforeAll(async () => {
  await resetDb();
  s = await seedBasics();
  jobA = await seedDraftJob(s.tenantA, s.customer1);
  jobB = await seedDraftJob(s.tenantB, s.customer2);
  await asService(async (tx) => {
    await tx`insert into parts_catalogue (tenant_id, name, default_price_cents, published) values (${s.tenantA}, 'Screen A', 1000000, true), (${s.tenantB}, 'Screen B', 1000000, true)`;
    await tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token) values (${s.tenantA}, ${jobA}, 'pickup_fee', 80000, '+254722000001', 'k1', 't1'), (${s.tenantB}, ${jobB}, 'pickup_fee', 80000, '+254722000002', 'k2', 't2')`;
    await tx`insert into notifications (tenant_id, user_id, channel, event_key, body) values (${s.tenantA}, ${s.customer1}, 'in_app', 'x', 'A'), (${s.tenantB}, ${s.customer2}, 'in_app', 'x', 'B')`;
    await tx`insert into tenant_secrets (tenant_id, daraja_enc) values (${s.tenantA}, 'encA'), (${s.tenantB}, 'encB')`;
    await tx`insert into audit_log (tenant_id, actor_user_id, action, entity) values (${s.tenantA}, ${s.adminA}, 'x', 'y'), (${s.tenantB}, ${s.adminB}, 'x', 'y')`;
    await tx`insert into short_links (code, tenant_id, job_id) values ('AAAAAAAA', ${s.tenantA}, ${jobA}), ('BBBBBBBB', ${s.tenantB}, ${jobB})`;
    await tx`insert into timers (tenant_id, job_id, kind, due_at) values (${s.tenantA}, ${jobA}, 'auto_close', now()), (${s.tenantB}, ${jobB}, 'auto_close', now())`;
  });
});
afterAll(closeAll);

describe('every table has RLS enabled', () => {
  it('no public table is left without RLS', async () => {
    const rows = await service`select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' and not rowsecurity`;
    expect(rows.map((r) => r.tablename)).toEqual([]);
  });
});

describe('tenant isolation: shop_admin of tenant B sees nothing of tenant A', () => {
  for (const table of BUSINESS_TABLES) {
    it(table, async () => {
      const rows = await asUser({ userId: s.adminB, tenantId: s.tenantB }, (tx) => tx.unsafe(`select tenant_id from ${table}`));
      expect(rows.every((r) => r.tenant_id === s.tenantB || r.tenant_id === null), `${table} leaked ${JSON.stringify(rows)}`).toBe(true);
      expect(rows.some((r) => r.tenant_id === s.tenantA)).toBe(false);
    });
  }

  it('tenant B admin cannot see tenant A itself or its domains', async () => {
    const t = await asUser({ userId: s.adminB, tenantId: s.tenantB }, (tx) => tx`select id from tenants`);
    expect(t.map((r) => r.id)).toEqual([s.tenantB]);
  });

  it('tenant B admin cannot update tenant A settings', async () => {
    const n = await asUser({ userId: s.adminB, tenantId: s.tenantB }, (tx) => tx`update tenant_settings set consultation_fee_cents = 1 where tenant_id = ${s.tenantA}`);
    expect(n.count).toBe(0);
  });
});

describe('customers', () => {
  it('see only their own jobs on the shop host they are visiting', async () => {
    const own = await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select id from jobs`);
    expect(own.map((r) => r.id)).toEqual([jobA]);
    const wrongHost = await asUser({ userId: s.customer1, tenantId: s.tenantB }, (tx) => tx`select id from jobs`);
    expect(wrongHost).toHaveLength(0);
    const other = await asUser({ userId: s.customer2, tenantId: s.tenantA }, (tx) => tx`select id from jobs`);
    expect(other).toHaveLength(0);
  });

  it('cannot read other customers, staff secrets, or the outbox', async () => {
    const users = await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select id from users`);
    expect(users.map((r) => r.id)).toEqual([s.customer1]);
    const secrets = await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select * from tenant_secrets`);
    expect(secrets).toHaveLength(0);
    const outbox = await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select * from outbox`);
    expect(outbox).toHaveLength(0);
    const sessions = await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`select * from sessions`);
    expect(sessions).toHaveLength(0);
  });

  it('cannot change a job status directly', async () => {
    await expect(asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`update jobs set status = 'in_repair' where id = ${jobA}`)).rejects.toThrow(/transition_job/);
  });

  it('can only insert jobs for themselves in draft on the current host', async () => {
    await expect(
      asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`insert into jobs (tenant_id, ref, customer_user_id, device_type, device_model, status) values (${s.tenantA}, 'X-1', ${s.customer2}, 'iphone', 'x', 'draft')`),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`insert into jobs (tenant_id, ref, customer_user_id, device_type, device_model, status) values (${s.tenantA}, 'X-2', ${s.customer1}, 'iphone', 'x', 'in_repair')`),
    ).rejects.toThrow(/row-level security/);
    const ok = await asUser({ userId: s.customer1, tenantId: s.tenantA }, (tx) => tx`insert into jobs (tenant_id, ref, customer_user_id, device_type, device_model) values (${s.tenantA}, 'X-3', ${s.customer1}, 'iphone', 'x') returning id`);
    expect(ok).toHaveLength(1);
  });
});

describe('job secrets (IMEI / passcode)', () => {
  it('visible to the customer, the assigned technician and the shop admin; hidden from other technicians', async () => {
    await asService((tx) => tx`update jobs set assigned_tech_id = ${s.techA} where id = ${jobA}`);
    const see = (userId: string) => asUser({ userId, tenantId: s.tenantA }, (tx) => tx`select identifier from job_secrets where job_id = ${jobA}`);
    expect(await see(s.customer1)).toHaveLength(1);
    expect(await see(s.techA)).toHaveLength(1);
    expect(await see(s.adminA)).toHaveLength(1);
    expect(await see(s.tech2A)).toHaveLength(0);
    expect(await see(s.adminB)).toHaveLength(0);
  });
});

describe('platform admin', () => {
  it('reads across tenants but cannot transition jobs without support mode', async () => {
    const t = await asUser({ userId: s.platformAdmin, tenantId: null }, (tx) => tx`select id from tenants order by slug`);
    expect(t.map((r) => r.id).sort()).toEqual([s.tenantA, s.tenantB].sort());
    await expect(
      asUser({ userId: s.platformAdmin, tenantId: s.tenantA }, (tx) => tx`select transition_job(${jobA}, 'pickup_fee_pending', 'platform_admin', ${s.platformAdmin})`),
    ).rejects.toThrow(/support mode|Illegal/);
  });

  it('in support mode acts like the shop admin of that tenant', async () => {
    const rows = await asUser({ userId: s.platformAdmin, tenantId: s.tenantA, impersonating: true }, (tx) => tx`select * from tenant_secrets`);
    expect(rows).toHaveLength(1);
  });
});

describe('append-only tables', () => {
  it('job_events and audit_log reject updates and deletes even for the service role', async () => {
    await asService((tx) => tx`insert into job_events (job_id, tenant_id, event_kind, actor_kind) values (${jobA}, ${s.tenantA}, 'note', 'system')`);
    await expect(asService((tx) => tx`update job_events set payload = '{"x":1}' where job_id = ${jobA}`)).rejects.toThrow(/append-only/);
    await expect(asService((tx) => tx`delete from audit_log where tenant_id = ${s.tenantA}`)).rejects.toThrow(/append-only/);
  });
});
