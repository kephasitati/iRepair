import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { servicePool } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';

/**
 * SMS deep link. Opens the exact job; if signed out, sends the customer to the OTP screen (DECISIONS Q-7: no
 * bearer-token auto-login from SMS). The phone number is not prefilled: anyone holding the link would see it.
 */
export default async function ShortLink({ params }: { params: Promise<{ code: string }> }) {
  const [{ code }, tenant] = await Promise.all([params, requireTenant()]);
  const [link] = await servicePool()`select s.job_id from short_links s
    where s.code = ${code.toUpperCase()} and s.tenant_id = ${tenant.id} and (s.expires_at is null or s.expires_at > now())`;
  if (!link) notFound();
  const session = await getSession();
  const dest = `/jobs/${link.job_id}`;
  if (session?.role) redirect(`/bench/jobs/${link.job_id}`);
  if (session) redirect(dest);
  redirect(`/login?next=${encodeURIComponent(dest)}`);
}
