import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { randomDigits, randomToken, sha256Hex } from './core/crypto';
import { normalizeKenyanPhone } from './core/phone';
import { verifyPassword } from './core/password';
import { servicePool, withService, type RequestCtx } from './db';
import { env, isProd } from './env';
import { getTenant, type Tenant } from './tenant';
import { smsSender } from './providers';

/**
 * Sessions are opaque random tokens stored hashed; the cookie is host-bound (DECISIONS D-9).
 * Customers sign in with phone + OTP; staff with email + password (+ optional TOTP).
 */

export const SESSION_COOKIE = 'rd_session';
const SESSION_DAYS = 30;
const OTP_TTL_MIN = 10;

export type SessionUser = {
  id: string;
  phone_e164: string | null;
  email: string | null;
  full_name: string;
  is_platform_admin: boolean;
  totp_enabled: boolean;
};

export type Session = {
  id: string;
  user: SessionUser;
  mfaVerified: boolean;
  impersonatingTenantId: string | null;
  /** Membership role on the current tenant, if any. */
  role: 'technician' | 'shop_admin' | null;
  tenantId: string | null;
};

// ---------------------------------------------------------------------------
// Rate limiting (fixed window in the rate_limits table)
// ---------------------------------------------------------------------------
export async function rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean> {
  const sql = servicePool();
  const [r] = await sql`
    insert into rate_limits (bucket, window_start, count) values (${bucket}, now(), 1)
    on conflict (bucket) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count`;
  return Number(r.count) <= max;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export async function createSession(
  userId: string,
  tenantId: string | null,
  opts: { mfaVerified?: boolean; impersonatingTenantId?: string; impersonationReason?: string } = {},
) {
  const token = randomToken(32);
  const h = await headers();
  const ua = h.get('user-agent')?.slice(0, 300) ?? null;
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
  const support = !!opts.impersonatingTenantId;
  await servicePool()`insert into sessions (user_id, token_hash, tenant_id, mfa_verified, ip, user_agent, expires_at, impersonating_tenant_id, impersonation_reason, impersonation_expires_at)
    values (${userId}, ${sha256Hex(token)}, ${tenantId}, ${opts.mfaVerified ?? false}, ${ip}::inet, ${ua},
            ${support ? new Date(Date.now() + 60 * 60 * 1000) : new Date(Date.now() + SESSION_DAYS * 86400 * 1000)},
            ${opts.impersonatingTenantId ?? null}, ${opts.impersonationReason ?? null}, ${support ? new Date(Date.now() + 60 * 60 * 1000) : null})`;
  await servicePool()`update users set last_login_at = now() where id = ${userId}`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: isProd(), path: '/', maxAge: support ? 3600 : SESSION_DAYS * 86400 });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await servicePool()`delete from sessions where token_hash = ${sha256Hex(token)}`;
  jar.delete(SESSION_COOKIE);
}

export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const tenant = await getTenant();
  const rows = await servicePool()`
    select s.id as session_id, s.mfa_verified, s.impersonating_tenant_id, s.impersonation_expires_at,
           u.id, u.phone_e164, u.email, u.full_name, u.is_platform_admin, u.totp_enabled, u.disabled,
           m.role
    from sessions s
    join users u on u.id = s.user_id
    left join tenant_memberships m on m.user_id = u.id and m.active and m.tenant_id = ${tenant?.id ?? null}
    where s.token_hash = ${sha256Hex(token)} and s.expires_at > now()
    limit 1`;
  const r = rows[0];
  if (!r || r.disabled) return null;
  // sliding expiry, throttled to once a minute (support-mode sessions keep their hard 60-minute limit)
  void servicePool()`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => ${SESSION_DAYS})
    where id = ${r.session_id} and impersonating_tenant_id is null and last_seen_at < now() - interval '1 minute'`.catch(() => {});
  const impersonating = r.impersonating_tenant_id && r.impersonation_expires_at && new Date(r.impersonation_expires_at) > new Date() ? r.impersonating_tenant_id : null;
  return {
    id: r.session_id,
    user: { id: r.id, phone_e164: r.phone_e164, email: r.email, full_name: r.full_name, is_platform_admin: r.is_platform_admin, totp_enabled: r.totp_enabled },
    mfaVerified: r.mfa_verified,
    impersonatingTenantId: impersonating,
    role: r.role ?? null,
    tenantId: tenant?.id ?? null,
  };
});

/** Request context for withUser(): who is acting, on which shop, in support mode or not. */
export async function requestCtx(): Promise<RequestCtx> {
  const s = await getSession();
  const t = await getTenant();
  return { userId: s?.user.id ?? null, tenantId: t?.id ?? null, impersonating: !!(s?.user.is_platform_admin && s.impersonatingTenantId && s.impersonatingTenantId === t?.id) };
}

export async function requireCustomer(next?: string): Promise<{ session: Session; tenant: Tenant }> {
  const tenant = await getTenant();
  const session = await getSession();
  if (!tenant) redirect('/');
  if (!session) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  return { session, tenant };
}

export async function requireStaff(minRole: 'technician' | 'shop_admin' = 'technician'): Promise<{ session: Session; tenant: Tenant; role: 'technician' | 'shop_admin' }> {
  const tenant = await getTenant();
  const session = await getSession();
  if (!tenant) redirect('/');
  if (!session) redirect('/staff/login');
  const supportMode = session.user.is_platform_admin && session.impersonatingTenantId === tenant.id;
  const role = supportMode ? 'shop_admin' : session.role;
  if (!role) redirect('/staff/login?error=not_staff');
  if (minRole === 'shop_admin' && role !== 'shop_admin') redirect('/bench?error=forbidden');
  if (role === 'shop_admin' && !supportMode && (session.user.totp_enabled || tenant.settings.require_admin_mfa) && !session.mfaVerified) {
    redirect(session.user.totp_enabled ? '/staff/mfa' : '/staff/mfa/setup');
  }
  return { session, tenant, role };
}

export async function requirePlatformAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/platform/login');
  if (!session.user.is_platform_admin) redirect('/platform/login?error=forbidden');
  if (!session.mfaVerified) redirect(session.user.totp_enabled ? '/platform/mfa' : '/platform/mfa/setup');
  return session;
}

// ---------------------------------------------------------------------------
// Phone OTP
// ---------------------------------------------------------------------------
export type OtpSendResult = { ok: true; phone: string } | { ok: false; error: 'invalid_phone' | 'rate_limited' | 'send_failed' };

export async function sendOtp(rawPhone: string, tenant: Tenant | null): Promise<OtpSendResult> {
  const phone = normalizeKenyanPhone(rawPhone);
  if (!phone) return { ok: false, error: 'invalid_phone' };
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'local';
  if (!(await rateLimit(`otp:phone:${phone}`, 3, 15 * 60)) || (isProd() && !(await rateLimit(`otp:ip:${ip}`, 10, 60 * 60)))) {
    return { ok: false, error: 'rate_limited' };
  }
  const code = env().OTP_DEV_CODE && !isProd() ? env().OTP_DEV_CODE! : randomDigits(6);
  await servicePool()`insert into otp_codes (phone_e164, code_hash, expires_at) values (${phone}, ${sha256Hex(`${phone}:${code}`)}, now() + make_interval(mins => ${OTP_TTL_MIN}))`;
  const shop = tenant?.branding.display_name ?? env().PLATFORM_NAME;
  const res = await smsSender(tenant).send({ to: phone, body: `${shop}: your sign-in code is ${code}. It expires in ${OTP_TTL_MIN} minutes.`, senderId: tenant?.branding.sms_sender_id });
  if (!res.ok) return { ok: false, error: 'send_failed' };
  return { ok: true, phone };
}

export type OtpVerifyResult = { ok: true; userId: string; isNew: boolean } | { ok: false; error: 'invalid_code' | 'expired' | 'too_many_attempts' };

export async function verifyOtp(phone: string, code: string, fullName?: string): Promise<OtpVerifyResult> {
  return withService(async (tx) => {
    const [row] = await tx`select * from otp_codes where phone_e164 = ${phone} and consumed_at is null order by created_at desc limit 1 for update`;
    if (!row) return { ok: false, error: 'expired' };
    if (new Date(row.expires_at) < new Date()) return { ok: false, error: 'expired' };
    if (row.attempts >= 5) return { ok: false, error: 'too_many_attempts' };
    if (row.code_hash !== sha256Hex(`${phone}:${code.trim()}`)) {
      await tx`update otp_codes set attempts = attempts + 1 where id = ${row.id}`;
      return { ok: false, error: 'invalid_code' };
    }
    await tx`update otp_codes set consumed_at = now() where id = ${row.id}`;
    const [existing] = await tx`select id, full_name from users where phone_e164 = ${phone}`;
    if (existing) {
      if (fullName && !existing.full_name) await tx`update users set full_name = ${fullName} where id = ${existing.id}`;
      return { ok: true, userId: existing.id, isNew: false };
    }
    const [u] = await tx`insert into users (phone_e164, full_name) values (${phone}, ${fullName ?? ''}) returning id`;
    return { ok: true, userId: u.id, isNew: true };
  });
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export async function staffLogin(email: string, password: string): Promise<{ ok: true; userId: string; totpEnabled: boolean } | { ok: false; error: 'invalid' | 'rate_limited' }> {
  const e = email.trim().toLowerCase();
  if (!(await rateLimit(`login:${e}`, 10, 15 * 60))) return { ok: false, error: 'rate_limited' };
  const [u] = await servicePool()`select id, password_hash, totp_enabled, disabled from users where email = ${e}`;
  if (!u || u.disabled || !(await verifyPassword(password, u.password_hash))) return { ok: false, error: 'invalid' };
  return { ok: true, userId: u.id, totpEnabled: u.totp_enabled };
}

export async function markMfaVerified(sessionId: string) {
  await servicePool()`update sessions set mfa_verified = true where id = ${sessionId}`;
}
