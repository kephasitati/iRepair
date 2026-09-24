import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth-card';
import { StaffLoginForm } from '@/components/auth-forms';
import { requireTenant } from '@/lib/tenant';

export default async function StaffLoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const [tenant, sp, t] = await Promise.all([requireTenant(), searchParams, getTranslations('auth')]);
  return (
    <AuthCard brand={tenant.branding.display_name} title={t('staffSignIn')} subtitle={t('staffHelp')}>
      <StaffLoginForm area="shop" next={sp.next} initialError={sp.error} />
    </AuthCard>
  );
}
