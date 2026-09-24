import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth-card';
import { MfaVerifyForm } from '@/components/auth-forms';
import { getSession } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';

export default async function StaffMfaPage() {
  const [tenant, session, t] = await Promise.all([requireTenant(), getSession(), getTranslations('auth')]);
  if (!session) redirect('/staff/login');
  if (!session.user.totp_enabled) redirect('/staff/mfa/setup');
  return (
    <AuthCard brand={tenant.branding.display_name} title={t('mfaTitle')} subtitle={t('mfaHelp')}>
      <MfaVerifyForm area="shop" />
    </AuthCard>
  );
}
