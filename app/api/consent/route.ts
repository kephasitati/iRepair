import { cookies, headers } from 'next/headers';
import { getSession } from '@/lib/auth';
import { randomToken, sha256Hex } from '@/lib/core/crypto';
import { servicePool } from '@/lib/db';
import { isProd } from '@/lib/env';
import { COOKIE_POLICY_VERSION, CONSENT_COOKIE, VISITOR_COOKIE } from '@/lib/legal';
import { getTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

/**
 * Records a cookie choice: sets rd_consent (read by the banner and by any optional script loader) and appends a row
 * to cookie_consents as proof of consent. Each change appends a new row, so withdrawals are recorded too.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { analytics?: boolean; marketing?: boolean };
  const analytics = body.analytics === true;
  const marketing = body.marketing === true;
  const [tenant, session, jar, h] = await Promise.all([getTenant(), getSession(), cookies(), headers()]);
  const visitorId = jar.get(VISITOR_COOKIE)?.value ?? randomToken(16);
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const choice = { v: COOKIE_POLICY_VERSION, analytics, marketing, at: new Date().toISOString() };

  await servicePool()`insert into cookie_consents (tenant_id, visitor_id, user_id, analytics, marketing, policy_version, ip_hash, user_agent)
    values (${tenant?.id ?? null}, ${visitorId}, ${session?.user.id ?? null}, ${analytics}, ${marketing}, ${COOKIE_POLICY_VERSION},
            ${ip ? sha256Hex(`${ip}:${day}`) : null}, ${h.get('user-agent')?.slice(0, 300) ?? null})`;

  const opts = { httpOnly: false, sameSite: 'lax' as const, secure: isProd(), path: '/', maxAge: 365 * 86400 };
  jar.set(CONSENT_COOKIE, encodeURIComponent(JSON.stringify(choice)), opts);
  jar.set(VISITOR_COOKIE, visitorId, { ...opts, httpOnly: true });
  return Response.json({ ok: true, choice });
}
