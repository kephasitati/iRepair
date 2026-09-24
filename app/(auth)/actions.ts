'use server';

import { redirect } from 'next/navigation';
import { createSession, destroySession, getSession, markMfaVerified, sendOtp, staffLogin, verifyOtp } from '@/lib/auth';
import { run, str, type ActionResult } from '@/lib/actions';
import { decrypt, encrypt, parseKey, sha256Hex } from '@/lib/core/crypto';
import { passwordProblems, hashPassword } from '@/lib/core/password';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '@/lib/core/totp';
import { servicePool, withService } from '@/lib/db';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';
import { UserError } from '@/lib/jobs/types';

function safeNext(next: string | null | undefined, fallback: string) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export async function sendOtpAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ phone: string }>> {
  return run(async () => {
    const tenant = await getTenant();
    const r = await sendOtp(str(fd, 'phone'), tenant);
    if (!r.ok) throw new UserError(r.error);
    return { phone: r.phone };
  });
}

export async function verifyOtpAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const tenant = await getTenant();
  const res = await run(async () => {
    const r = await verifyOtp(str(fd, 'phone'), str(fd, 'code'), str(fd, 'name') || undefined);
    if (!r.ok) throw new UserError(r.error);
    await createSession(r.userId, tenant?.id ?? null);
    return null;
  });
  if (res.ok) redirect(safeNext(str(fd, 'next'), '/jobs'));
  return res;
}

export async function signOutAction() {
  await destroySession();
  redirect('/');
}

// ---------------------------------------------------------------------------
// Staff & platform admin
// ---------------------------------------------------------------------------
export async function staffLoginAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const tenant = await getTenant();
  const platform = str(fd, 'area') === 'platform';
  let dest = '';
  const res = await run(async () => {
    const r = await staffLogin(str(fd, 'email'), str(fd, 'password'));
    if (!r.ok) throw new UserError(r.error === 'rate_limited' ? 'rate_limited' : 'invalid_login');
    if (platform) {
      const [u] = await servicePool()`select is_platform_admin from users where id = ${r.userId}`;
      if (!u?.is_platform_admin) throw new UserError('forbidden');
      await createSession(r.userId, null);
      dest = r.totpEnabled ? '/platform/mfa' : '/platform/mfa/setup';
      return null;
    }
    if (!tenant) throw new UserError('not_staff');
    const [m] = await servicePool()`select role from tenant_memberships where tenant_id = ${tenant.id} and user_id = ${r.userId} and active`;
    if (!m) throw new UserError('not_staff');
    await createSession(r.userId, tenant.id);
    const needMfa = m.role === 'shop_admin' && (r.totpEnabled || tenant.settings.require_admin_mfa);
    dest = needMfa ? (r.totpEnabled ? '/staff/mfa' : '/staff/mfa/setup') : safeNext(str(fd, 'next'), '/bench');
    return null;
  });
  if (res.ok) redirect(dest);
  return res;
}

function totpAad(userId: string) {
  return `totp:${userId}`;
}

async function readTotpSecret(userId: string): Promise<string | null> {
  const [u] = await servicePool()`select totp_secret_enc from users where id = ${userId}`;
  if (!u?.totp_secret_enc) return null;
  return decrypt(u.totp_secret_enc, parseKey(env().APP_MASTER_KEY), totpAad(userId));
}

export async function mfaVerifyAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session) redirect('/');
  const area = str(fd, 'area');
  const res = await run(async () => {
    const secret = await readTotpSecret(session.user.id);
    if (!secret || !verifyTotp(secret, str(fd, 'code'))) throw new UserError('mfa_wrong');
    await markMfaVerified(session.id);
    return null;
  });
  if (res.ok) redirect(area === 'platform' ? '/platform' : '/admin/settings');
  return res;
}

/** Start enrolment: a fresh secret is kept in the session row (pending) until the first code verifies. */
export async function mfaBeginSetup(): Promise<{ secret: string; url: string }> {
  const session = await getSession();
  if (!session) redirect('/');
  const tenant = await getTenant();
  const secret = generateTotpSecret();
  const master = parseKey(env().APP_MASTER_KEY);
  await servicePool()`update sessions set mfa_pending_enc = ${encrypt(secret, master, `mfa-pending:${session.id}`)} where id = ${session.id}`;
  const issuer = tenant?.branding.display_name ?? env().PLATFORM_NAME;
  return { secret, url: otpauthUrl(secret, session.user.email ?? session.user.phone_e164 ?? session.user.id, issuer) };
}

export async function mfaCompleteSetupAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const session = await getSession();
  if (!session) redirect('/');
  const area = str(fd, 'area');
  const res = await run(async () => {
    const [s] = await servicePool()`select mfa_pending_enc from sessions where id = ${session.id}`;
    if (!s?.mfa_pending_enc) throw new UserError('mfa_wrong');
    const master = parseKey(env().APP_MASTER_KEY);
    const secret = decrypt(s.mfa_pending_enc, master, `mfa-pending:${session.id}`);
    if (!verifyTotp(secret, str(fd, 'code'))) throw new UserError('mfa_wrong');
    await withService(async (tx) => {
      await tx`update users set totp_secret_enc = ${encrypt(secret, master, totpAad(session.user.id))}, totp_enabled = true where id = ${session.user.id}`;
      await tx`update sessions set mfa_pending_enc = null, mfa_verified = true where id = ${session.id}`;
      await tx`insert into audit_log (tenant_id, actor_user_id, action, entity, entity_id) values (${session.tenantId}, ${session.user.id}, 'mfa.enable', 'user', ${session.user.id})`;
    });
    return null;
  });
  if (res.ok) redirect(area === 'platform' ? '/platform' : '/admin/settings');
  return res;
}

/** Staff invite acceptance: set name and password, then sign in. */
export async function acceptInviteAction(_prev: unknown, fd: FormData): Promise<ActionResult<null>> {
  const tenant = await getTenant();
  const res = await run(async () => {
    if (!tenant) throw new UserError('Invalid invitation.');
    const token = str(fd, 'token');
    const password = str(fd, 'password');
    const problems = passwordProblems(password);
    if (problems.length) throw new UserError(`password:${problems.join(',')}`);
    const userId = await withService(async (tx) => {
      const [m] = await tx`select m.user_id from tenant_memberships m where m.tenant_id = ${tenant.id} and m.invite_token_hash = ${sha256Hex(token)} and m.invite_expires_at > now()`;
      if (!m) throw new UserError('This invitation has expired. Ask your shop admin for a new one.');
      await tx`update users set password_hash = ${await hashPassword(password)}, full_name = coalesce(nullif(${str(fd, 'name')}, ''), full_name) where id = ${m.user_id}`;
      await tx`update tenant_memberships set invite_token_hash = null, invite_expires_at = null, active = true where tenant_id = ${tenant.id} and user_id = ${m.user_id}`;
      return m.user_id as string;
    });
    await createSession(userId, tenant.id);
    return null;
  });
  if (res.ok) redirect('/bench');
  return res;
}
