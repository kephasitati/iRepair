'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createSession, destroySession, getSession, requirePlatformAdmin } from '@/lib/auth';
import { run, str, type ActionResult } from '@/lib/actions';
import { generateDataKey, parseKey, randomToken, sha256Hex, wrapDataKey } from '@/lib/core/crypto';
import { hashPassword } from '@/lib/core/password';
import { normalizeKenyanPhone } from '@/lib/core/phone';
import { servicePool, withService } from '@/lib/db';
import { env } from '@/lib/env';
import { invalidateTenantCache, getTenant } from '@/lib/tenant';
import { UserError } from '@/lib/jobs/types';

async function platformAudit(actor: string, tenantId: string | null, action: string, diff?: unknown) {
  const sql = servicePool();
  await sql`insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id, diff) values (${tenantId}, ${actor}, ${action}, 'tenant', ${tenantId}, ${diff ? sql.json(diff as never) : null})`;
}

export async function createTenantAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ tenantId: string; inviteUrl: string }>> {
  return run(async () => {
    const admin = await requirePlatformAdmin();
    const slug = str(fd, 'slug').toLowerCase();
    const name = str(fd, 'name');
    const adminEmail = str(fd, 'admin_email').toLowerCase();
    const phone = normalizeKenyanPhone(str(fd, 'contact_phone'));
    if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/.test(slug)) throw new UserError('Subdomain: lowercase letters, numbers and dashes, 3-40 characters.');
    if (['www', 'api', 'admin', 'platform', 'app', 'mail'].includes(slug)) throw new UserError('That subdomain is reserved.');
    if (!name) throw new UserError('Enter the shop name.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new UserError('Enter the shop admin email.');
    if (!phone) throw new UserError('Enter a valid shop phone number.');
    const host = `${slug}.${env().PLATFORM_ROOT_DOMAIN}`;
    const token = randomToken(24);
    const tenantId = await withService(async (tx) => {
      const [exists] = await tx`select 1 from tenants where slug = ${slug}`;
      if (exists) throw new UserError('That subdomain is taken.');
      const [t] = await tx`insert into tenants (slug, name) values (${slug}, ${name}) returning id`;
      await tx`insert into tenant_domains (hostname, tenant_id, kind, is_primary, verified_at) values (${host}, ${t.id}, 'subdomain', true, now())`;
      await tx`insert into tenant_branding (tenant_id, display_name) values (${t.id}, ${name})`;
      await tx`insert into tenant_settings (tenant_id, contact_phone) values (${t.id}, ${phone})`;
      await tx`insert into tenant_keys (tenant_id, wrapped_data_key) values (${t.id}, ${wrapDataKey(generateDataKey(), parseKey(env().APP_MASTER_KEY), t.id)})`;
      const feeKind = str(fd, 'fee_kind') || 'percent';
      const feeValue = Math.round(Number(str(fd, 'fee_value') || '0') * (feeKind === 'percent' ? 100 : 100));
      if (feeValue > 0) await tx`insert into platform_fee_rules (tenant_id, kind, value) values (${t.id}, ${feeKind}, ${feeValue})`;
      let [u] = await tx`select id from users where email = ${adminEmail}`;
      if (!u) [u] = await tx`insert into users (email, full_name, password_hash) values (${adminEmail}, '', ${await hashPassword(randomToken(24))}) returning id`;
      await tx`insert into tenant_memberships (tenant_id, user_id, role, invited_by, invite_token_hash, invite_expires_at)
        values (${t.id}, ${u.id}, 'shop_admin', ${admin.user.id}, ${sha256Hex(token)}, now() + interval '7 days')`;
      return t.id as string;
    });
    await platformAudit(admin.user.id, tenantId, 'tenant.create', { slug, name, adminEmail });
    revalidatePath('/platform');
    return { tenantId, inviteUrl: `${env().PUBLIC_SCHEME}://${host}/staff/invite/${token}` };
  });
}

export async function setTenantStatusAction(tenantId: string, status: 'active' | 'suspended') {
  const admin = await requirePlatformAdmin();
  const [t] = await servicePool()`update tenants set status = ${status} where id = ${tenantId} returning (select hostname from tenant_domains where tenant_id = ${tenantId} and is_primary)`;
  invalidateTenantCache(t?.hostname);
  await platformAudit(admin.user.id, tenantId, `tenant.${status === 'active' ? 'unsuspend' : 'suspend'}`);
  revalidatePath('/platform');
}

export async function setFeeAction(tenantId: string, fd: FormData) {
  const admin = await requirePlatformAdmin();
  const kind = str(fd, 'kind') === 'flat' ? 'flat' : 'percent';
  const value = Math.round(Number(str(fd, 'value') || '0') * 100); // KES -> cents, or % -> basis points
  await servicePool()`insert into platform_fee_rules (tenant_id, kind, value) values (${tenantId}, ${kind}, ${value})`;
  await platformAudit(admin.user.id, tenantId, 'tenant.fee', { kind, value });
  revalidatePath(`/platform/tenants/${tenantId}`);
}

export async function addDomainAction(tenantId: string, fd: FormData) {
  const admin = await requirePlatformAdmin();
  const host = str(fd, 'hostname').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+(:\d+)?$/.test(host)) return;
  await servicePool()`insert into tenant_domains (hostname, tenant_id, kind) values (${host}, ${tenantId}, 'custom') on conflict do nothing`;
  await platformAudit(admin.user.id, tenantId, 'tenant.domain.add', { host });
  revalidatePath(`/platform/tenants/${tenantId}`);
}

/** Start support mode: single-use handoff to the shop host, then an audited, time-boxed session there. */
export async function enterSupportModeAction(tenantId: string, fd: FormData) {
  const admin = await requirePlatformAdmin();
  const reason = str(fd, 'reason');
  if (reason.length < 5) redirect(`/platform/tenants/${tenantId}?error=reason`);
  const token = randomToken(32);
  const sql = servicePool();
  const [d] = await sql`select hostname from tenant_domains where tenant_id = ${tenantId} and is_primary`;
  await sql`insert into support_handoffs (token_hash, user_id, tenant_id, reason, expires_at) values (${sha256Hex(token)}, ${admin.user.id}, ${tenantId}, ${reason}, now() + interval '60 seconds')`;
  await platformAudit(admin.user.id, tenantId, 'support.handoff', { reason });
  redirect(`${/localhost/.test(d.hostname) ? 'http' : 'https'}://${d.hostname}/staff/support?token=${encodeURIComponent(token)}`);
}

/** Runs on the shop host. */
export async function completeSupportHandoff(token: string): Promise<boolean> {
  const tenant = await getTenant();
  if (!tenant) return false;
  const h = await withService(async (tx) => {
    const [row] = await tx`update support_handoffs set used_at = now() where token_hash = ${sha256Hex(token)} and used_at is null and expires_at > now() and tenant_id = ${tenant.id} returning user_id, reason`;
    if (!row) return null;
    const [u] = await tx`select is_platform_admin, disabled from users where id = ${row.user_id}`;
    return u?.is_platform_admin && !u.disabled ? row : null;
  });
  if (!h) return false;
  await createSession(h.user_id, tenant.id, { mfaVerified: true, impersonatingTenantId: tenant.id, impersonationReason: h.reason });
  await platformAudit(h.user_id, tenant.id, 'support.start', { reason: h.reason });
  return true;
}

export async function exitSupportModeAction() {
  const session = await getSession();
  const tenant = await getTenant();
  if (session?.impersonatingTenantId) await platformAudit(session.user.id, session.impersonatingTenantId, 'support.end');
  await destroySession();
  redirect(tenant ? `${env().PUBLIC_SCHEME}://${env().PLATFORM_ROOT_DOMAIN}/platform` : '/platform');
}

export async function retryOutboxAction(id: number) {
  await requirePlatformAdmin();
  await servicePool()`update outbox set status = 'pending', attempts = 0, next_attempt_at = now() where id = ${id} and status in ('dead', 'failed')`;
  revalidatePath('/platform/monitor');
}
