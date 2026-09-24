import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { AcceptInviteForm } from '@/components/auth-forms';
import { sha256Hex } from '@/lib/core/crypto';
import { servicePool } from '@/lib/db';
import { requireTenant } from '@/lib/tenant';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const [{ token }, tenant] = await Promise.all([params, requireTenant()]);
  const [m] = await servicePool()`select u.email from tenant_memberships m join users u on u.id = m.user_id
    where m.tenant_id = ${tenant.id} and m.invite_token_hash = ${sha256Hex(token)} and m.invite_expires_at > now()`;
  if (!m) notFound();
  return (
    <AuthCard brand={tenant.branding.display_name} title={`Join ${tenant.branding.display_name}`} subtitle="Set your name and password to activate your staff account.">
      <AcceptInviteForm token={token} email={m.email} />
    </AuthCard>
  );
}
