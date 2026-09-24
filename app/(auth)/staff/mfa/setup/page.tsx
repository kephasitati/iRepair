import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { getTranslations } from 'next-intl/server';
import { AuthCard } from '@/components/auth-card';
import { MfaSetupForm } from '@/components/auth-forms';
import { getSession } from '@/lib/auth';
import { requireTenant } from '@/lib/tenant';
import { mfaBeginSetup } from '@/app/(auth)/actions';

export const dynamic = 'force-dynamic';

export default async function StaffMfaSetupPage() {
  const [tenant, session, t] = await Promise.all([requireTenant(), getSession(), getTranslations('auth')]);
  if (!session) redirect('/staff/login');
  const { secret, url } = await mfaBeginSetup();
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 384 });
  return (
    <AuthCard brand={tenant.branding.display_name} title={t('mfaSetupTitle')} subtitle={t('mfaSetupHelp')}>
      <MfaSetupForm area="shop" secret={secret} qrDataUrl={qr} />
    </AuthCard>
  );
}
