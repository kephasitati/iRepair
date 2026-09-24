import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { StaffLoginForm } from '@/components/auth-forms';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // The platform console only exists on the platform host, never on a shop's domain.
  if (await getTenant()) notFound();
  const sp = await searchParams;
  return (
    <AuthCard brand={env().PLATFORM_NAME} title="Platform console" subtitle="Platform administrators only. Two-factor authentication is required.">
      <StaffLoginForm area="platform" initialError={sp.error} />
    </AuthCard>
  );
}
