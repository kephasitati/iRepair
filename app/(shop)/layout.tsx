import { redirect } from 'next/navigation';
import { ShopHeader } from '@/components/shop-header';
import { CookieBanner } from '@/components/cookie-banner';
import { getSession } from '@/lib/auth';
import { getTenant } from '@/lib/tenant';

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getTenant();
  if (!tenant) redirect('/platform');
  if (tenant.status === 'suspended') {
    return (
      <main className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="display text-[32px]">{tenant.branding.display_name}</h1>
        <p className="mt-3 text-ink-3">Online bookings are temporarily unavailable. Please call {tenant.settings.contact_phone}.</p>
      </main>
    );
  }
  const session = await getSession();
  return (
    <>
      <ShopHeader tenant={tenant} session={session} />
      <main>{children}</main>
      <CookieBanner />
    </>
  );
}
