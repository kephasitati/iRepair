import { notFound } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { StaffLoginForm } from '@/components/auth-forms';
import { IRepairsLogo } from '@/components/irepairs-logo';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';

export default async function PlatformLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // The platform console only exists on the platform host, never on a shop's domain.
  if (await getTenant()) notFound();
  const sp = await searchParams;
  return (
    <AuthCard
      brand={env().PLATFORM_NAME}
      logo={<IRepairsLogo className="h-6 w-auto text-ink" />}
      title="Platform console"
      subtitle="Platform administrators only. Two-factor authentication is required."
    >
      <StaffLoginForm area="platform" initialError={sp.error} />
    </AuthCard>
  );
}
