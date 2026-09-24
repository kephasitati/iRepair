'use server';

import { revalidatePath } from 'next/cache';
import { requestCtx, requireStaff } from '@/lib/auth';
import { kesField, run, str, type ActionResult } from '@/lib/actions';
import { audit } from '@/lib/audit';
import { isValidHex } from '@/lib/branding';
import { randomToken, sha256Hex } from '@/lib/core/crypto';
import { hashPassword } from '@/lib/core/password';
import { normalizeKenyanPhone } from '@/lib/core/phone';
import { validateTemplate } from '@/lib/core/templates';
import { withUser } from '@/lib/db';
import { UserError } from '@/lib/jobs/types';
import { brandingKey, putObject } from '@/lib/storage';
import { invalidateTenantCache } from '@/lib/tenant';
import { encryptJson } from '@/lib/tenant-crypto';

async function admin() {
  const { session, tenant } = await requireStaff('shop_admin');
  const ctx = await requestCtx();
  const impersonatedBy = session.user.is_platform_admin && session.impersonatingTenantId === tenant.id ? session.user.id : null;
  return { session, tenant, ctx, userId: session.user.id, impersonatedBy };
}

function bool(fd: FormData, k: string) {
  return fd.get(k) === 'on' || fd.get(k) === 'true';
}

function int(fd: FormData, k: string, min: number, max: number, label: string) {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`${label} must be between ${min} and ${max}.`);
  return n;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export async function saveSettingsAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, impersonatedBy } = await admin();
    const section = str(fd, 'section');
    await withUser(ctx, async (tx) => {
      if (section === 'branding') {
        const primary = str(fd, 'primary_hex');
        const accent = str(fd, 'accent_hex');
        if (!isValidHex(primary) || !isValidHex(accent)) throw new UserError('Colours must be hex like #0f3d3e.');
        const patch: Record<string, unknown> = {
          display_name: str(fd, 'display_name') || tenant.name,
          tagline: str(fd, 'tagline') || null,
          primary_hex: primary,
          accent_hex: accent,
          sms_sender_id: str(fd, 'sms_sender_id') || null,
          email_from_name: str(fd, 'email_from_name') || null,
        };
        for (const [field, name] of [['logo', 'logo_path'], ['icon', 'icon_path']] as const) {
          const file = fd.get(field);
          if (file instanceof File && file.size > 0) {
            if (file.size > 1024 * 1024) throw new UserError('Images must be under 1 MB.');
            const ext = file.type === 'image/png' ? 'png' : file.type === 'image/svg+xml' ? 'svg' : file.type === 'image/webp' ? 'webp' : file.type === 'image/jpeg' ? 'jpg' : null;
            if (!ext) throw new UserError('Use a PNG, JPG, WebP or SVG image.');
            const key = brandingKey(tenant.id, `${field}-${Date.now()}`, ext);
            await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
            patch[name] = key;
          }
        }
        await tx`update tenant_branding set ${tx(patch)} where tenant_id = ${tenant.id}`;
        await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'settings.branding', entity: 'tenant', entityId: tenant.id, diff: patch });
      } else if (section === 'contact') {
        const phone = normalizeKenyanPhone(str(fd, 'contact_phone'));
        if (!phone) throw new UserError('Enter a valid shop phone number.');
        const lat = str(fd, 'address_lat') ? Number(str(fd, 'address_lat')) : null;
        const lng = str(fd, 'address_lng') ? Number(str(fd, 'address_lng')) : null;
        const hours: Record<string, { open: string; close: string } | null> = {};
        for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
          const open = str(fd, `${d}_open`);
          const close = str(fd, `${d}_close`);
          hours[d] = bool(fd, `${d}_on`) && /^\d{2}:\d{2}$/.test(open) && /^\d{2}:\d{2}$/.test(close) && open < close ? { open, close } : null;
        }
        const zones = str(fd, 'service_zones').split(/\r?\n|,/).map((z) => z.trim()).filter(Boolean);
        const patch = {
          contact_phone: phone,
          contact_email: str(fd, 'contact_email') || null,
          address_formatted: str(fd, 'address_formatted'),
          address_landmark: str(fd, 'address_landmark') || null,
          address_lat: lat,
          address_lng: lng,
          opening_hours: tx.json(hours),
          service_zones: zones,
        };
        await tx`update tenant_settings set ${tx(patch)} where tenant_id = ${tenant.id}`;
        await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'settings.contact', entity: 'tenant', entityId: tenant.id, diff: { ...patch, opening_hours: hours } });
      } else if (section === 'fees') {
        const depositKind = str(fd, 'deposit_kind') === 'fixed' ? 'fixed' : 'percent';
        const depositValue = depositKind === 'fixed' ? kesField(fd, 'deposit_fixed') : int(fd, 'deposit_percent', 0, 100, 'Deposit percentage') * 100;
        const vatRate = Number(str(fd, 'vat_rate'));
        if (!(vatRate >= 0 && vatRate <= 50)) throw new UserError('VAT rate must be between 0 and 50%.');
        const kra = str(fd, 'kra_pin').toUpperCase();
        if (kra && !/^[AP]\d{9}[A-Z]$/.test(kra)) throw new UserError('KRA PIN looks wrong (e.g. P051234567X).');
        if (bool(fd, 'vat_registered') && !kra) throw new UserError('A VAT-registered shop needs a KRA PIN on its invoices.');
        const patch = {
          consultation_fee_cents: kesField(fd, 'consultation_fee'),
          consultation_fee_credited: bool(fd, 'consultation_fee_credited'),
          deposit_rule: tx.json({ kind: depositKind, value: depositValue }),
          deposit_min_quote_cents: kesField(fd, 'deposit_min'),
          vat_registered: bool(fd, 'vat_registered'),
          vat_rate_bp: Math.round(vatRate * 100),
          prices_include_vat: bool(fd, 'prices_include_vat'),
          kra_pin: kra || null,
          delivery_markup_bp: int(fd, 'markup', 0, 100, 'Markup') * 100,
          collect_supplementary_upfront: bool(fd, 'collect_supplementary_upfront'),
        };
        await tx`update tenant_settings set ${tx(patch)} where tenant_id = ${tenant.id}`;
        await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'settings.fees', entity: 'tenant', entityId: tenant.id, diff: { ...patch, deposit_rule: { kind: depositKind, value: depositValue } } });
      } else if (section === 'operations') {
        const patch = {
          max_negotiation_rounds: int(fd, 'max_negotiation_rounds', 0, 10, 'Negotiation rounds'),
          quote_expiry_hours: int(fd, 'quote_expiry_hours', 1, 720, 'Quote expiry'),
          expired_quote_autodecline_days: int(fd, 'expired_quote_autodecline_days', 1, 60, 'Auto-decline'),
          retention_days: int(fd, 'retention_days', 7, 3650, 'Retention'),
          warranty_days: int(fd, 'warranty_days', 0, 365, 'Warranty'),
          auto_close_hours: int(fd, 'auto_close_hours', 1, 720, 'Auto-close'),
          unclaimed_after_days: int(fd, 'unclaimed_after_days', 1, 60, 'Unclaimed alert'),
          quiet_hours_start: str(fd, 'quiet_hours_start') || '21:00',
          quiet_hours_end: str(fd, 'quiet_hours_end') || '07:00',
          delivery_provider: str(fd, 'delivery_provider') === 'tumaboda' ? 'tumaboda' : 'mock',
          publish_price_list: bool(fd, 'publish_price_list'),
          require_admin_mfa: bool(fd, 'require_admin_mfa'),
        };
        await tx`update tenant_settings set ${tx(patch)} where tenant_id = ${tenant.id}`;
        await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'settings.operations', entity: 'tenant', entityId: tenant.id, diff: patch });
      } else {
        throw new UserError('Unknown section.');
      }
    });
    invalidateTenantCache(tenant.hostname);
    return null;
  });
  revalidatePath('/', 'layout');
  return r;
}

/** Integration credentials are encrypted with the tenant key and never sent back to the browser. */
export async function saveCredentialsAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, impersonatedBy } = await admin();
    const kind = str(fd, 'kind') as 'daraja' | 'courier' | 'sms';
    const clear = str(fd, 'clear') === '1';
    let value: unknown = null;
    if (!clear) {
      if (kind === 'daraja') {
        const type = str(fd, 'type') === 'till' ? 'till' : 'paybill';
        value = {
          env: str(fd, 'env') === 'production' ? 'production' : 'sandbox',
          consumerKey: str(fd, 'consumerKey'),
          consumerSecret: str(fd, 'consumerSecret'),
          shortcode: str(fd, 'shortcode'),
          passkey: str(fd, 'passkey'),
          type,
          tillNumber: type === 'till' ? str(fd, 'tillNumber') : undefined,
        };
        const v = value as Record<string, string>;
        if (!v.consumerKey || !v.consumerSecret || !/^\d{5,7}$/.test(v.shortcode) || !v.passkey) throw new UserError('Fill in all Daraja fields (shortcode is 5-7 digits).');
        if (type === 'till' && !/^\d{5,7}$/.test(v.tillNumber ?? '')) throw new UserError('Enter the till number.');
      } else if (kind === 'courier') {
        value = { baseUrl: str(fd, 'baseUrl'), apiKey: str(fd, 'apiKey'), webhookSecret: str(fd, 'webhookSecret') };
        const v = value as Record<string, string>;
        if (!/^https:\/\//.test(v.baseUrl) || !v.apiKey || !v.webhookSecret) throw new UserError('Fill in the TumaBoda base URL (https), API key and webhook secret.');
      } else if (kind === 'sms') {
        value = { username: str(fd, 'username'), apiKey: str(fd, 'apiKey'), senderId: str(fd, 'senderId') || null };
        const v = value as Record<string, string>;
        if (!v.username || !v.apiKey) throw new UserError("Fill in the Africa's Talking username and API key.");
      } else throw new UserError('Unknown integration.');
    }
    await withUser(ctx, async (tx) => {
      const enc = value ? await encryptJson(tenant.id, value, `tenant-secrets:${tenant.id}:${kind}`) : null;
      const col = kind === 'daraja' ? 'daraja_enc' : kind === 'courier' ? 'courier_enc' : 'sms_enc';
      await tx`insert into tenant_secrets (tenant_id) values (${tenant.id}) on conflict (tenant_id) do nothing`;
      await tx`update tenant_secrets set ${tx({ [col]: enc })} where tenant_id = ${tenant.id}`;
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: `credentials.${kind}.${clear ? 'clear' : 'set'}`, entity: 'tenant', entityId: tenant.id });
    });
    return null;
  });
  revalidatePath('/admin/settings');
  return r;
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export async function inviteStaffAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ url: string }>> {
  return run(async () => {
    const { tenant, ctx, userId, impersonatedBy } = await admin();
    const email = str(fd, 'email').toLowerCase();
    const role = str(fd, 'role') === 'shop_admin' ? 'shop_admin' : 'technician';
    const phone = str(fd, 'phone') ? normalizeKenyanPhone(str(fd, 'phone')) : null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new UserError('Enter a valid email.');
    const token = randomToken(24);
    const { withService } = await import('@/lib/db');
    await withService(async (tx) => {
      let [u] = await tx`select id from users where email = ${email}`;
      if (!u) [u] = await tx`insert into users (email, phone_e164, full_name, password_hash) values (${email}, ${phone}, ${str(fd, 'name')}, ${await hashPassword(randomToken(24))}) returning id`;
      await tx`insert into tenant_memberships (tenant_id, user_id, role, active, invited_by, invite_token_hash, invite_expires_at)
        values (${tenant.id}, ${u.id}, ${role}, false, ${userId}, ${sha256Hex(token)}, now() + interval '48 hours')
        on conflict (tenant_id, user_id) do update set role = excluded.role, invite_token_hash = excluded.invite_token_hash, invite_expires_at = excluded.invite_expires_at`;
    });
    await withUser(ctx, (tx) => audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'staff.invite', entity: 'user', entityId: email, diff: { role } }));
    revalidatePath('/admin/staff');
    return { url: `${tenant.baseUrl}/staff/invite/${token}` };
  });
}

export async function updateMemberAction(memberId: string, patch: { role?: 'technician' | 'shop_admin'; active?: boolean }) {
  const { tenant, ctx, userId, impersonatedBy } = await admin();
  if (memberId === userId && (patch.active === false || patch.role === 'technician')) return; // cannot lock yourself out
  await withUser(ctx, async (tx) => {
    await tx`update tenant_memberships set ${tx(patch as Record<string, unknown>)} where tenant_id = ${tenant.id} and user_id = ${memberId}`;
    await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'staff.update', entity: 'user', entityId: memberId, diff: patch });
  });
  revalidatePath('/admin/staff');
}

// ---------------------------------------------------------------------------
// Parts catalogue
// ---------------------------------------------------------------------------
export async function savePartAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, impersonatedBy } = await admin();
    const id = str(fd, 'id') || null;
    const name = str(fd, 'name');
    if (!name) throw new UserError('Enter a name.');
    const row = {
      name,
      sku: str(fd, 'sku') || null,
      device_family: str(fd, 'device_family') || null,
      kind: ['part', 'labour', 'service'].includes(str(fd, 'kind')) ? str(fd, 'kind') : 'part',
      default_price_cents: kesField(fd, 'price'),
      published: bool(fd, 'published'),
      active: id ? bool(fd, 'active') : true,
    };
    await withUser(ctx, async (tx) => {
      if (id) await tx`update parts_catalogue set ${tx(row)} where id = ${id} and tenant_id = ${tenant.id}`;
      else await tx`insert into parts_catalogue ${tx({ ...row, tenant_id: tenant.id })}`;
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: id ? 'part.update' : 'part.create', entity: 'part', entityId: id, diff: row });
    });
    return null;
  });
  revalidatePath('/admin/parts');
  return r;
}

// ---------------------------------------------------------------------------
// Refunds (recorded after paying the customer back by hand; B2C is out of scope)
// ---------------------------------------------------------------------------
export async function recordRefundAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, impersonatedBy } = await admin();
    const ref = str(fd, 'job_ref').toUpperCase();
    const amount = kesField(fd, 'amount');
    const reason = str(fd, 'reason');
    const method = ['mpesa_manual', 'cash', 'bank', 'other'].includes(str(fd, 'method')) ? str(fd, 'method') : 'mpesa_manual';
    if (amount <= 0) throw new UserError('Enter the amount refunded.');
    if (!reason) throw new UserError('Give a reason.');
    await withUser(ctx, async (tx) => {
      const [job] = await tx`select id from jobs where tenant_id = ${tenant.id} and ref = ${ref}`;
      if (!job) throw new UserError(`No job ${ref}.`);
      const [{ paid }] = await tx`select paid_cents(${job.id}) as paid`;
      const [{ refunded }] = await tx`select coalesce(sum(amount_cents), 0) as refunded from refunds where job_id = ${job.id}`;
      if (amount > Number(paid) - Number(refunded)) throw new UserError('Refund is more than the customer has paid for this job.');
      await tx`insert into refunds (tenant_id, job_id, amount_cents, reason, method, reference, recorded_by) values (${tenant.id}, ${job.id}, ${amount}, ${reason}, ${method}, ${str(fd, 'reference') || null}, ${userId})`;
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: 'refund.record', entity: 'job', entityId: job.id, diff: { amount, method, reason } });
    });
    return null;
  });
  revalidatePath('/admin/refunds');
  return r;
}

// ---------------------------------------------------------------------------
// Notification templates
// ---------------------------------------------------------------------------
export async function saveTemplateAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const r = await run(async () => {
    const { tenant, ctx, userId, impersonatedBy } = await admin();
    const body = str(fd, 'body');
    const check = validateTemplate(body);
    if (!check.ok) throw new UserError(`Unknown or forbidden variables: ${[...check.unknown, ...check.forbidden].map((v) => `{${v}}`).join(', ')}`);
    const key = { event_key: str(fd, 'event_key'), audience: str(fd, 'audience'), channel: str(fd, 'channel') };
    const reset = str(fd, 'reset') === '1';
    await withUser(ctx, async (tx) => {
      await tx`delete from notification_templates where tenant_id = ${tenant.id} and event_key = ${key.event_key} and audience = ${key.audience}::notification_audience and channel = ${key.channel}::notification_channel`;
      if (!reset) {
        await tx`insert into notification_templates (tenant_id, event_key, audience, channel, title, body, critical, enabled)
          values (${tenant.id}, ${key.event_key}, ${key.audience}::notification_audience, ${key.channel}::notification_channel, ${str(fd, 'title') || null}, ${body}, ${bool(fd, 'critical')}, ${bool(fd, 'enabled')})`;
      }
      await audit(tx, { tenantId: tenant.id, actorUserId: userId, impersonatedBy, action: reset ? 'template.reset' : 'template.save', entity: 'template', entityId: `${key.event_key}/${key.audience}/${key.channel}` });
    });
    return null;
  });
  revalidatePath('/admin/templates');
  return r;
}
