import { notFound, redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { AuthCard } from '@/components/auth-card';
import { MfaSetupForm } from '@/components/auth-forms';
import { getSession } from '@/lib/auth';
import { env } from '@/lib/env';
import { getTenant } from '@/lib/tenant';
import { mfaBeginSetup } from '@/app/(auth)/actions';

export const dynamic = 'force-dynamic';

export default async function PlatformMfaSetupPage() {
  if (await getTenant()) notFound();
  const session = await getSession();
  if (!session?.user.is_platform_admin) redirect('/platform/login');
  const { secret, url } = await mfaBeginSetup();
  const qr = await QRCode.toDataURL(url, { margin: 1, width: 384 });
  return (
    <AuthCard brand={env().PLATFORM_NAME} title="Set up two-factor authentication" subtitle="Required for platform administrators.">
      <MfaSetupForm area="platform" secret={secret} qrDataUrl={qr} />
    </AuthCard>
  );
}
