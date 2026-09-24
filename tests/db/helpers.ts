import postgres, { type Sql, type TransactionSql } from 'postgres';
import { migrate, TEST_OWNER_URL } from '@/scripts/migrate';

// DB tests run against their own database (repairdesk_test) because they drop and recreate the schema.
export const APP_URL = process.env.TEST_DATABASE_URL ?? 'postgres://repairdesk_app:app_dev_password@localhost:55432/repairdesk_test';
export const SERVICE_URL = process.env.TEST_DATABASE_SERVICE_URL ?? 'postgres://repairdesk_service:service_dev_password@localhost:55432/repairdesk_test';

export const app: Sql = postgres(APP_URL, { max: 2, onnotice: () => {} });
export const service: Sql = postgres(SERVICE_URL, { max: 2, onnotice: () => {} });

export async function resetDb() {
  await migrate({ reset: true, quiet: true, url: TEST_OWNER_URL });
}

export async function closeAll() {
  await Promise.all([app.end(), service.end()]);
}

export type Ctx = { userId?: string | null; tenantId?: string | null; impersonating?: boolean };

/** Run `fn` inside an app-role transaction with the request context set (what the web app does per request). */
export async function asUser<T>(ctx: Ctx, fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return app.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${ctx.userId ?? ''}, true),
                    set_config('app.tenant_id', ${ctx.tenantId ?? ''}, true),
                    set_config('app.impersonating', ${ctx.impersonating ? 'true' : ''}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/** Service-role transaction with the trusted flag set (worker, webhooks). */
export async function asService<T>(fn: (tx: TransactionSql) => Promise<T>): Promise<T> {
  return service.begin(async (tx) => {
    await tx`select set_config('app.trusted', 'true', true)`;
    return fn(tx);
  }) as Promise<T>;
}

export type Seed = {
  tenantA: string;
  tenantB: string;
  adminA: string;
  techA: string;
  tech2A: string;
  adminB: string;
  customer1: string;
  customer2: string;
  platformAdmin: string;
};

export async function seedBasics(): Promise<Seed> {
  return asService(async (tx) => {
    const mkTenant = async (slug: string, name: string) => {
      const [t] = await tx`insert into tenants (slug, name) values (${slug}, ${name}) returning id`;
      await tx`insert into tenant_domains (hostname, tenant_id, kind, is_primary) values (${slug + '.localhost:3000'}, ${t.id}, 'subdomain', true)`;
      await tx`insert into tenant_branding (tenant_id, display_name) values (${t.id}, ${name})`;
      await tx`insert into tenant_settings (tenant_id, contact_phone, vat_registered) values (${t.id}, '+254700000000', true)`;
      return t.id as string;
    };
    const mkUser = async (phone: string | null, email: string | null, name: string, pa = false) => {
      const [u] = await tx`insert into users (phone_e164, email, full_name, is_platform_admin) values (${phone}, ${email}, ${name}, ${pa}) returning id`;
      return u.id as string;
    };
    const tenantA = await mkTenant('alpha', 'Alpha Repairs');
    const tenantB = await mkTenant('beta', 'Beta Repairs');
    const adminA = await mkUser('+254711000001', 'admin@alpha.test', 'Alpha Admin');
    const techA = await mkUser('+254711000002', 'tech@alpha.test', 'Alpha Tech');
    const tech2A = await mkUser('+254711000003', 'tech2@alpha.test', 'Alpha Tech Two');
    const adminB = await mkUser('+254711000004', 'admin@beta.test', 'Beta Admin');
    const customer1 = await mkUser('+254722000001', null, 'Wanjiku Customer');
    const customer2 = await mkUser('+254722000002', null, 'Otieno Customer');
    const platformAdmin = await mkUser(null, 'root@platform.test', 'Platform Root', true);
    await tx`insert into tenant_memberships (tenant_id, user_id, role) values
      (${tenantA}, ${adminA}, 'shop_admin'), (${tenantA}, ${techA}, 'technician'), (${tenantA}, ${tech2A}, 'technician'), (${tenantB}, ${adminB}, 'shop_admin')`;
    return { tenantA, tenantB, adminA, techA, tech2A, adminB, customer1, customer2, platformAdmin };
  });
}

/** A booked job for `customer` at `tenant` with everything the draft->pickup_fee_pending guard needs. */
export async function seedDraftJob(tenant: string, customer: string, opts: { status?: string } = {}) {
  return asService(async (tx) => {
    const [{ ref }] = await tx`select next_job_ref(${tenant}) as ref`;
    const [j] = await tx`insert into jobs (tenant_id, ref, customer_user_id, device_type, device_brand, device_model, fault_description,
        pickup_address, pickup_window_start, pickup_window_end, consultation_fee_cents, pickup_fee_cents, declared_value_cents, terms_version, terms_accepted_at)
      values (${tenant}, ${ref}, ${customer}, 'iphone', 'Apple', 'iPhone 13', 'Cracked screen',
        ${tx.json({ formatted: 'Kimathi St, Nairobi', lat: -1.2833, lng: 36.8233 })}, now() + interval '2 hours', now() + interval '4 hours', 50000, 80000, 6000000, 'test', now())
      returning id`;
    await tx`insert into job_secrets (job_id, tenant_id, identifier, identifier_kind) values (${j.id}, ${tenant}, '490154203237518', 'imei')`;
    await tx`insert into job_photos (job_id, tenant_id, stage, kind, storage_key) values
      (${j.id}, ${tenant}, 'customer_declared', 'front', 'k/front.jpg'), (${j.id}, ${tenant}, 'customer_declared', 'back', 'k/back.jpg')`;
    if (opts.status && opts.status !== 'draft') {
      // Force a status for tests that start mid-lifecycle (bypasses the guard trigger, service only).
      await tx`select set_config('app.in_transition', 'true', true)`;
      await tx`update jobs set status = ${opts.status}::job_status where id = ${j.id}`;
    }
    return j.id as string;
  });
}

export async function transition(jobId: string, to: string, actor: string, actorUserId: string | null = null, payload: unknown = {}) {
  return asService(async (tx) => {
    const [row] = await tx`select * from transition_job(${jobId}, ${to}::job_status, ${actor}::actor_kind, ${actorUserId}, ${tx.json(payload as never)})`;
    return row;
  });
}

export async function status(jobId: string): Promise<string> {
  const [r] = await service`select status from jobs where id = ${jobId}`;
  return r.status;
}

export async function paySuccess(jobId: string, tenantId: string, purpose: string, amountCents: number) {
  return asService(async (tx) => {
    const key = `${jobId}:${purpose}:${Date.now()}:${Math.random()}`;
    const [p] = await tx`insert into payments (tenant_id, job_id, purpose, amount_cents, phone_e164, idempotency_key, callback_token, checkout_request_id, status)
      values (${tenantId}, ${jobId}, ${purpose}::payment_purpose, ${amountCents}, '+254722000001', ${key}, ${key + ':cb'}, ${'ws_CO_' + key}, 'pending') returning *`;
    const [c] = await tx`select * from confirm_payment(${p.checkout_request_id}, 0, 'Success', ${'QAB' + Math.floor(Math.random() * 1e6)}, ${amountCents}, '{}'::jsonb)`;
    return c;
  });
}
