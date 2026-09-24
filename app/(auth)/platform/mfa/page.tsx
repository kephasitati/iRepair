import { notFound, redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { MfaVerifyForm } from '@/components/auth-forms';
import { getSession } from '@/lib/auth';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';

export default async function PlatformMfaPage() {
  if (await getTenant()) notFound();
  const session = await getSession();
  if (!session?.user.is_platform_admin) redirect('/platform/login');
  if (!session.user.totp_enabled) redirect('/platform/mfa/setup');
  return (
    <AuthCard brand={env().PLATFORM_NAME} title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app.">
      <MfaVerifyForm area="platform" />
    </AuthCard>
  );
}
